import type { NoteNode } from "~/lib/webhooks/actions/composeRun";
import type { BuildChanges } from "./types";

function paragraph(content: NoteNode[]): NoteNode {
  return { type: "paragraph", content };
}

function text(value: string, href?: string | null): NoteNode {
  return href
    ? { type: "text", text: value, marks: [{ type: "link", attrs: { href } }] }
    : { type: "text", text: value };
}

function bulletList(items: NoteNode[][]): NoteNode {
  return {
    type: "bulletList",
    content: items.map((content) => ({
      type: "listItem",
      content: [paragraph(content)],
    })),
  };
}

/**
 * What a push's build was made of, for the run's note: the pull requests,
 * each title linking to the pull request, then the commits no pull request
 * contains. Nothing when the lookup found nothing or did not run.
 */
export function buildChangesNodes(
  changes: BuildChanges | null | undefined
): NoteNode[] {
  if (!changes) return [];
  const nodes: NoteNode[] = [];
  if (changes.pullRequests.length > 0) {
    nodes.push(
      paragraph([
        text(`Pull requests in this build (${changes.pullRequests.length})`),
      ]),
      bulletList(
        changes.pullRequests.map((pr) => [
          text(`PR #${pr.number}: ${pr.title}`, pr.url),
        ])
      )
    );
  }
  if (changes.orphanCommits.length > 0) {
    nodes.push(
      paragraph([
        text(`Commits not in a pull request (${changes.orphanCommits.length})`),
      ]),
      bulletList(
        changes.orphanCommits.map((c) => [
          text(c.shortSha, c.url),
          text(` ${c.subject}`),
        ])
      )
    );
  }
  if (changes.truncated && changes.uncheckedCommits > 0) {
    nodes.push(
      paragraph([text(`…and ${changes.uncheckedCommits} more commits`)])
    );
  }
  return nodes;
}
