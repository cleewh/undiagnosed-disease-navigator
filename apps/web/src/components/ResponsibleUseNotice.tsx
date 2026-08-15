import { RESPONSIBLE_USE_NOTICE } from "../constants.js";

// Persistent Responsible_Use_Notice banner (Requirements 24.6, 25.1). It is
// rendered once in the app shell and pinned within the viewport so it stays
// visible without scrolling.
export function ResponsibleUseNotice() {
  return (
    <div
      role="note"
      aria-label="Responsible use notice"
      data-testid="responsible-use-notice"
      className="responsible-use-notice"
    >
      <strong>Responsible use: </strong>
      {RESPONSIBLE_USE_NOTICE}
    </div>
  );
}
