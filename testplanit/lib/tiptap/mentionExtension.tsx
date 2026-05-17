import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import { SuggestionOptions } from "@tiptap/suggestion";
import tippy, { Instance as TippyInstance } from "tippy.js";
import {
  MentionSuggestion,
  MentionSuggestionRef,
  MentionUser,
} from "~/components/comments/MentionSuggestion";

/**
 * Fetch users for mention suggestions
 * @param query Search query
 * @param projectId Project ID to check membership
 * @returns Array of users matching the query
 */
async function fetchMentionUsers(
  query: string,
  projectId: number
): Promise<MentionUser[]> {
  try {
    const response = await fetch(
      `/api/users/search-for-mentions?q=${encodeURIComponent(query)}&projectId=${projectId}`
    );

    if (!response.ok) {
      console.error("Failed to fetch mention users");
      return [];
    }

    const data = await response.json();
    const users = data.users || [];

    // Filter out inactive and deleted users
    const filteredUsers = users.filter(
      (user: MentionUser) => user.isActive && !user.isDeleted
    );

    // Sort: project members first, then by name
    return filteredUsers.sort((a: MentionUser, b: MentionUser) => {
      // Project members come first
      if (a.isProjectMember && !b.isProjectMember) return -1;
      if (!a.isProjectMember && b.isProjectMember) return 1;

      // Within the same group, sort alphabetically by name
      const nameA = (a.name || a.email).toLowerCase();
      const nameB = (b.name || b.email).toLowerCase();
      return nameA.localeCompare(nameB);
    });
  } catch (error) {
    console.error("Error fetching mention users:", error);
    return [];
  }
}

/**
 * Create mention extension with suggestion configuration.
 *
 * @param projectId      Project ID to check user membership
 * @param currentUserId  Logged-in user id. When a mention's id matches, the
 *                       rendered pill grows a filled Star next to the avatar
 *                       — same affordance the React `UserMention` component
 *                       uses, so a `@you` in a comment body reads the same
 *                       as a banner mention. Optional; mentions render
 *                       without the Star when unset.
 */
export function createMentionExtension(
  projectId: number,
  currentUserId?: string
) {
  return Mention.extend({
    addAttributes() {
      // Get parent attributes and extend them
      const parentAttributes = this.parent?.() || {};

      return {
        ...parentAttributes,
        image: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-image"),
          renderHTML: (attributes) => {
            if (!attributes.image) {
              return {};
            }
            return {
              "data-image": attributes.image,
            };
          },
        },
      };
    },
    // Remove ReactNodeViewRenderer to avoid flushSync issues with React 19
    // Use renderHTML instead for plain DOM rendering
    renderHTML({ node, HTMLAttributes }) {
      const userName = node.attrs.label as string;
      const userImage = node.attrs.image as string | null;
      const userId = node.attrs.id as string;

      // Get current locale from URL
      const locale = window.location.pathname.split("/")[1] || "en-US";

      // Generate initials (same logic as Avatar component)
      const abbreviateAltText = (altText: string): string => {
        let result = altText.charAt(0);
        const firstSpaceIndex = altText.indexOf(" ");
        if (firstSpaceIndex > -1 && firstSpaceIndex < altText.length - 1) {
          result += altText.charAt(firstSpaceIndex + 1);
        }
        return result.toUpperCase();
      };

      // Generate color code (same logic as stringToColorCode utility)
      const stringToColorCode = (
        inputString: string
      ): { colorCode: string; textColor: string } => {
        let hash = 0;
        for (let i = 0; i < inputString.length; i++) {
          hash = inputString.charCodeAt(i) + ((hash << 5) - hash);
        }
        let colorCode = "#";
        let red = 0,
          green = 0,
          blue = 0;

        for (let i = 0; i < 3; i++) {
          const value = (hash >> (i * 8)) & 0xff;
          if (i === 0) blue = value;
          else if (i === 1) green = value;
          else if (i === 2) red = value;

          colorCode += ("00" + value.toString(16)).substr(-2);
        }

        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        const textColor = luminance < 128 ? "#ffffff" : "#000000";

        return { colorCode, textColor };
      };

      const initials = abbreviateAltText(userName);
      const { colorCode, textColor } = stringToColorCode(userName);

      // Build avatar element (image or initials)
      const avatarElement = userImage
        ? [
            "img",
            {
              src: userImage,
              alt: userName,
              class: "inline-block h-4 w-4 rounded-full",
              style: "width: 16px; height: 16px;",
            },
          ]
        : [
            "div",
            {
              class:
                "inline-flex items-center justify-center h-4 w-4 rounded-full text-[8px] font-semibold",
              style: `width: 16px; height: 16px; background-color: ${colorCode}; color: ${textColor};`,
            },
            initials,
          ];

      // Lucide's `Star` glyph reproduced as inline SVG so the raw-DOM render
      // path emits the same affordance the React UserMention component
      // shows. Path data is copied verbatim from
      // `node_modules/lucide-react/dist/esm/icons/star.js` (v0.577) so the
      // visual matches lucide's `<Star />` pixel-for-pixel.
      //
      // `fill-current` paints the star in the pill's resolved text color
      // (inherits from the parent `<a class="text-secondary-foreground">`),
      // so the star tone tracks the text tone across themes.
      // ProseMirror's DOMSerializer renders tuples via `document.createElement`,
      // which puts `<svg>` in the HTML namespace and produces an inert element
      // with no glyph. The space-prefix `"<ns> <tag>"` form switches the
      // serializer to `createElementNS`, and child elements inherit the
      // namespace — so the path here renders as proper SVG.
      const SVG_NS = "http://www.w3.org/2000/svg";
      const isCurrentUser = currentUserId != null && currentUserId === userId;
      const starElement = isCurrentUser
        ? [
            `${SVG_NS} svg`,
            {
              class: "w-3 h-3 min-w-3 fill-current shrink-0",
              width: "24",
              height: "24",
              viewBox: "0 0 24 24",
              fill: "none",
              stroke: "currentColor",
              "stroke-width": "2",
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "aria-hidden": "true",
            },
            [
              "path",
              {
                d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
              },
            ],
          ]
        : null;

      // Children of the inner anchor — `starElement` is filtered out when
      // the viewer isn't the mentioned user.
      const anchorChildren = [
        avatarElement,
        starElement,
        ["span", { class: "truncate max-w-[14rem]" }, userName],
      ].filter(Boolean);

      return [
        "span",
        {
          ...HTMLAttributes,
          class: "mention inline-flex items-center align-middle mx-0.5",
          "data-type": "mention",
          "data-id": userId,
          "data-label": userName,
          "data-image": userImage,
        },
        [
          "a",
          {
            href: `/${locale}/users/profile/${userId}`,
            class:
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground border border-muted-foreground/50 hover:bg-secondary/80 cursor-pointer transition-colors no-underline align-middle max-w-[16rem]",
          },
          ...anchorChildren,
        ],
      ];
    },
  }).configure({
    HTMLAttributes: {
      class: "mention",
    },
    suggestion: {
      items: async ({ query }) => {
        return fetchMentionUsers(query, projectId);
      },
      command: ({ editor, range, props }) => {
        // Delete the mention trigger character and insert the mention node with all attributes
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: "mention",
            attrs: {
              id: props.id,
              label: props.label,
              image: props.image,
            },
          })
          .run();
      },
      render: () => {
        let component: ReactRenderer<MentionSuggestionRef> | undefined;
        let popup: TippyInstance[] | undefined;

        return {
          onStart: (props) => {
            component = new ReactRenderer(MentionSuggestion, {
              props,
              editor: props.editor,
            });

            if (!props.clientRect) {
              return;
            }

            popup = tippy("body", {
              getReferenceClientRect: props.clientRect as () => DOMRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: "manual",
              placement: "bottom-start",
            });
          },

          onUpdate(props) {
            component?.updateProps(props);

            if (!props.clientRect) {
              return;
            }

            popup?.[0]?.setProps({
              getReferenceClientRect: props.clientRect as () => DOMRect,
            });
          },

          onKeyDown(props) {
            if (props.event.key === "Escape") {
              popup?.[0]?.hide();
              return true;
            }

            return component?.ref?.onKeyDown(props) ?? false;
          },

          onExit() {
            popup?.[0]?.destroy();
            component?.destroy();
          },
        };
      },
    } as Partial<SuggestionOptions>,
  });
}
