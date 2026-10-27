// Modified for PalmDesk: render Markdown with markdown-it behind a link allowlist.
// Original Glassline code is Apache-2.0.
import MarkdownIt from "markdown-it";

const markdown = createMarkdown();

export function groupTimelineItems(items) {
  const grouped = [];
  let pendingActions = [];

  for (const item of items) {
    if (item.type === "message") {
      flushActions(grouped, pendingActions);
      pendingActions = [];
      grouped.push(item);
    } else {
      pendingActions.push(item);
    }
  }

  flushActions(grouped, pendingActions);
  return grouped;
}

export function findLatestTimelineFocusBlock(blocks) {
  const list = Array.from(blocks);
  const latestMessage = [...list]
    .reverse()
    .find((block) => block.dataset?.timelineType === "message");

  return latestMessage ?? list.at(-1) ?? null;
}

export function shouldFocusLatestTimeline({ preserveSelection } = {}) {
  return !preserveSelection;
}

export function captureOpenDisclosureIds(root) {
  return new Set(
    [...root.querySelectorAll("details[data-disclosure-id]")]
      .filter((node) => node.open)
      .map((node) => node.dataset.disclosureId)
      .filter(Boolean)
  );
}

export function restoreOpenDisclosureIds(root, openIds) {
  for (const node of root.querySelectorAll("details[data-disclosure-id]")) {
    node.open = openIds.has(node.dataset.disclosureId);
  }
}

export function renderCommandBody(item) {
  return `
    <pre class="command-text">${escapeHtml(item.command)}</pre>
    ${item.output ? renderCollapsedOutput(item.output, disclosureId(item, "output")) : ""}
  `;
}

export function renderMessageBody(item) {
  return `<div class="message-markdown">${renderMarkdown(textForTimelineItem(item))}</div>`;
}

export function renderMarkdown(value, { copyLabel = "Copy" } = {}) {
  return markdown.render(String(value ?? ""), { copyLabel });
}

function createMarkdown() {
  // Raw HTML stays escaped, and single newlines keep their line breaks.
  const md = new MarkdownIt({ html: false, breaks: true });
  // Images would make the controller fetch arbitrary URLs from agent output.
  md.disable("image");
  md.validateLink = isSafeHref;
  md.core.ruler.push("palmdesk_heading_levels", (state) => {
    // Messages sit inside cards, so "#" starts at <h3>.
    for (const token of state.tokens) {
      if (token.type === "heading_open" || token.type === "heading_close") {
        token.tag = `h${Math.min(Number(token.tag.slice(1)) + 2, 6)}`;
      }
    }
  });
  md.core.ruler.push("palmdesk_task_items", markTaskItems);
  md.renderer.rules.task_checkbox = (tokens, index) =>
    `<input type="checkbox" disabled${tokens[index].meta.checked ? " checked" : ""}> `;
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noreferrer");
    return self.renderToken(tokens, index, options);
  };
  md.renderer.rules.table_open = () => '<div class="table-scroll"><table>\n';
  md.renderer.rules.table_close = () => "</table></div>\n";
  md.renderer.rules.fence = (tokens, index, options, env) =>
    renderCodeBlock(tokens[index].content, tokens[index].info.trim().split(/\s+/)[0], env);
  md.renderer.rules.code_block = (tokens, index, options, env) =>
    renderCodeBlock(tokens[index].content, "", env);
  return md;
}

// GitHub-style "- [ ] task" items; markdown-it core has no task lists.
function markTaskItems(state) {
  const { tokens } = state;
  for (let index = 2; index < tokens.length; index += 1) {
    const first = tokens[index].children?.[0];
    const match = first?.type === "text" ? /^\[([ xX])\]\s+/.exec(first.content) : null;
    if (
      !match ||
      tokens[index - 1].type !== "paragraph_open" ||
      tokens[index - 2].type !== "list_item_open"
    ) {
      continue;
    }

    first.content = first.content.slice(match[0].length);
    const checkbox = new state.Token("task_checkbox", "input", 0);
    checkbox.meta = { checked: match[1] !== " " };
    tokens[index].children.unshift(checkbox);
    tokens[index - 2].attrJoin("class", "task-item");
  }
}

function renderCodeBlock(code, language, { copyLabel }) {
  const languageClass = language ? ` class="language-${escapeHtml(language)}"` : "";
  return (
    `<div class="code-block"><div class="code-header"><span>${escapeHtml(language)}</span>` +
    `<button type="button" data-copy-code>${escapeHtml(copyLabel)}</button></div>` +
    `<pre><code${languageClass}>${escapeHtml(code)}</code></pre></div>\n`
  );
}

export function renderActivityGroup(group) {
  const tone = group.items.some(isFailedAction) ? "bad" : "neutral";
  return `
    <details class="activity-group" data-tone="${tone}" data-disclosure-id="${escapeHtml(activityGroupDisclosureId(group))}">
      <summary>${escapeHtml(activitySummary(group.items))}</summary>
      <div class="activity-items">
        ${group.items.map(renderActivityItem).join("")}
      </div>
    </details>
  `;
}

export function textForTimelineItem(item) {
  if (item.type === "command") {
    return [item.command, item.output].filter(Boolean).join("\n\n");
  }

  if (item.type === "file_change") {
    return [item.path, item.summary, item.diff].filter(Boolean).join("\n\n");
  }

  if (item.type === "tool_call") {
    return JSON.stringify({ name: item.name, input: item.input, output: item.output }, null, 2);
  }

  return item.content ?? item.detail ?? "";
}

export function titleForTimelineItem(item) {
  if (item.type === "activity_group") {
    return "activity";
  }

  if (item.type === "message") {
    return `${item.role} message`;
  }

  if (item.type === "command") {
    return `command${item.exitCode === undefined || item.exitCode === null ? "" : ` · exit ${item.exitCode}`}`;
  }

  if (item.type === "file_change") {
    return `file · ${item.path}`;
  }

  if (item.type === "tool_call") {
    return `tool · ${item.name}`;
  }

  return `status · ${item.status}`;
}

function flushActions(grouped, actions) {
  if (actions.length === 0) {
    return;
  }

  grouped.push({
    id: `activity:${actions[0].id}`,
    type: "activity_group",
    createdAt: actions[0].createdAt,
    items: actions
  });
}

function renderActivityItem(item) {
  return `
    <section class="activity-item" data-kind="${escapeHtml(item.type)}">
      <header class="activity-item-header">
        <strong>${escapeHtml(titleForTimelineItem(item))}</strong>
        ${isFailedAction(item) ? '<span class="badge" data-tone="bad">FAILED</span>' : ""}
      </header>
      <div class="activity-item-body">
        ${bodyForActivityItem(item)}
      </div>
    </section>
  `;
}

function bodyForActivityItem(item) {
  if (item.type === "command") {
    return renderCommandBody(item);
  }

  if (item.type === "tool_call") {
    return renderToolCallBody(item);
  }

  if (item.type === "file_change") {
    return renderFileChangeBody(item);
  }

  if (item.type === "status") {
    return `<p>${escapeHtml(item.detail ?? item.status ?? "")}</p>`;
  }

  return `<p>${escapeHtml(textForTimelineItem(item))}</p>`;
}

function renderToolCallBody(item) {
  return `
    <p>${escapeHtml(item.name ?? "tool")} · ${escapeHtml(item.status ?? "unknown")}</p>
    ${
      item.input !== undefined
        ? renderCollapsedOutputWithLabel(formatUnknown(item.input), "Show input", disclosureId(item, "input"))
        : ""
    }
    ${
      item.output !== undefined
        ? renderCollapsedOutputWithLabel(formatUnknown(item.output), "Show output", disclosureId(item, "output"))
        : ""
    }
  `;
}

function renderFileChangeBody(item) {
  return `
    <p>${escapeHtml(item.summary ?? item.path)}</p>
    ${item.diff ? renderCollapsedOutputWithLabel(item.diff, "Show diff", disclosureId(item, "diff")) : ""}
  `;
}

function renderCollapsedOutput(output, id) {
  return renderCollapsedOutputWithLabel(output, "Show output", id);
}

function renderCollapsedOutputWithLabel(output, label, id) {
  const disclosureAttr = id ? ` data-disclosure-id="${escapeHtml(id)}"` : "";
  return `
    <details class="command-output"${disclosureAttr}>
      <summary>${escapeHtml(outputSummary(output, label))}</summary>
      <pre>${escapeHtml(output)}</pre>
    </details>
  `;
}

function outputSummary(output, label) {
  const lines = String(output).split("\n").length;
  return `${label} (${lines} ${lines === 1 ? "line" : "lines"})`;
}

function activitySummary(items) {
  const counts = items.reduce(
    (result, item) => {
      result.total += 1;
      if (item.type === "command") result.commands += 1;
      if (item.type === "tool_call") result.tools += 1;
      if (item.type === "file_change") result.files += 1;
      if (item.type === "status") result.status += 1;
      if (isFailedAction(item)) result.failed += 1;
      return result;
    },
    { total: 0, commands: 0, tools: 0, files: 0, status: 0, failed: 0 }
  );

  return [
    plural(counts.total, "action"),
    counts.commands ? plural(counts.commands, "command") : null,
    counts.tools ? plural(counts.tools, "tool") : null,
    counts.files ? plural(counts.files, "file") : null,
    counts.status ? plural(counts.status, "status", "status") : null,
    counts.failed ? plural(counts.failed, "failed", "failed") : null
  ]
    .filter(Boolean)
    .join(" · ");
}

function plural(count, singular, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function activityGroupDisclosureId(group) {
  return `activity:${group.items[0]?.id ?? group.id ?? "unknown"}`;
}

function disclosureId(item, suffix) {
  return item.id ? `${item.id}:${suffix}` : "";
}

function isSafeHref(href) {
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isFailedAction(item) {
  if (item.type === "command") {
    return typeof item.exitCode === "number" && item.exitCode !== 0;
  }

  return item.status === "failed";
}

function formatUnknown(value) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
