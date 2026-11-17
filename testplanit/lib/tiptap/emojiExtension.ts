import { Emoji, gitHubEmojis } from "@tiptap/extension-emoji";

/**
 * The one emoji extension instance for the page.
 *
 * Constructing the extension builds its storage, which checks the browser's
 * support for every emoji version in the list (a canvas draw per version).
 * Extension instances hold no editor state, so the editor and the static
 * read-only renderer share this one and that scan runs once per page load.
 */
export const emojiExtension = Emoji.configure({
  emojis: gitHubEmojis,
  enableEmoticons: true,
});
