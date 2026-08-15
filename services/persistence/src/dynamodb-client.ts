// services/persistence/src/dynamodb-client.ts
//
// Real AWS SDK v3 implementation of `DocumentClientPort`, wrapping a
// `DynamoDBDocumentClient`. It translates the port's semantic write
// preconditions into DynamoDB `ConditionExpression`s and builds
// `KeyConditionExpression`s for base-table and GSI queries. A failed
// conditional write surfaces as `ConditionalCheckFailedError` so the
// repository can map it onto the appropriate domain error.

import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  type DynamoDBClientConfig
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";

import { ConditionalCheckFailedError } from "./errors.js";
import { PK, SK } from "./keys.js";
import type { Item } from "./keys.js";
import type {
  DocumentClientPort,
  GetSpec,
  PutSpec,
  QuerySpec,
  WritePrecondition
} from "./port.js";

interface ConditionParts {
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
}

/** Translate a semantic write precondition into DynamoDB condition-expression parts. */
function buildConditionParts(precondition: WritePrecondition | undefined): ConditionParts {
  if (precondition === undefined) {
    return {};
  }
  if (precondition.kind === "create-only") {
    return {
      ConditionExpression: "attribute_not_exists(#pk)",
      ExpressionAttributeNames: { "#pk": PK }
    };
  }
  // expected-version
  return {
    ConditionExpression: "#version = :expectedVersion",
    ExpressionAttributeNames: { "#version": "version" },
    ExpressionAttributeValues: { ":expectedVersion": precondition.version }
  };
}

/**
 * `DocumentClientPort` backed by a live DynamoDB single table via the AWS SDK
 * v3 document client. Requires AWS credentials at runtime, but never at build
 * or unit-test time (tests use {@link InMemoryDocumentClient} instead).
 */
export class DynamoDbDocumentClientAdapter implements DocumentClientPort {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(doc: DynamoDBDocumentClient, tableName: string) {
    this.doc = doc;
    this.tableName = tableName;
  }

  /**
   * Convenience factory that constructs a `DynamoDBDocumentClient` (with
   * sensible marshalling defaults) from a table name and optional low-level
   * client configuration.
   */
  static create(
    tableName: string,
    config: DynamoDBClientConfig = {}
  ): DynamoDbDocumentClientAdapter {
    const doc = DynamoDBDocumentClient.from(new DynamoDBClient(config), {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false }
    });
    return new DynamoDbDocumentClientAdapter(doc, tableName);
  }

  async put(spec: PutSpec): Promise<void> {
    const condition = buildConditionParts(spec.precondition);
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: spec.item,
          ...condition
        })
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new ConditionalCheckFailedError();
      }
      throw error;
    }
  }

  async get(spec: GetSpec): Promise<Item | undefined> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { [PK]: spec.key.PK, [SK]: spec.key.SK }
      })
    );
    return result.Item as Item | undefined;
  }

  async query(spec: QuerySpec): Promise<Item[]> {
    const names: Record<string, string> = { "#pk": spec.partitionAttribute };
    const values: Record<string, unknown> = { ":pk": spec.partitionValue };
    let keyCondition = "#pk = :pk";

    if (spec.sortBeginsWith !== undefined && spec.sortAttribute !== undefined) {
      names["#sk"] = spec.sortAttribute;
      values[":skPrefix"] = spec.sortBeginsWith;
      keyCondition += " AND begins_with(#sk, :skPrefix)";
    }

    const items: Item[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const result = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: spec.indexName,
          KeyConditionExpression: keyCondition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ScanIndexForward: spec.scanIndexForward ?? true,
          ExclusiveStartKey: exclusiveStartKey
        })
      );
      for (const item of result.Items ?? []) {
        items.push(item as Item);
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey !== undefined);

    return items;
  }
}
