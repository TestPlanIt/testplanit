import { ReactRenderer } from "@tiptap/react";
import tippy, { Instance as TippyInstance } from "tippy.js";
import Mention from "@tiptap/extension-mention";
import { SuggestionOptions } from "@tiptap/suggestion";
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
    const filteredUsers = users.filter((user: MentionUser) => user.isActive && !user.isDeleted);

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
 * Create mention extension with suggestion configuration
 * @param projectId Project ID to check user membership
 * @returns Configured Mention extension
 */
export function createMentionExtension(projectId: number) {
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
      const locale = window.location.pathname.split('/')[1] || 'en-US';

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
      const stringToColorCode = (inputString: string): { colorCode: string; textColor: string } => {
        let hash = 0;
        for (let i = 0; i < inputString.length; i++) {
          hash = inputString.charCodeAt(i) + ((hash << 5) - hash);
        }
        let colorCode = "#";
        let red = 0, green = 0, blue = 0;

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
            'img',
            {
              src: userImage,
              alt: userName,
              class: 'inline-block h-4 w-4 rounded-full',
              style: 'width: 16px; height: 16px;',
            },
          ]
        : [
            'div',
            {
              class: 'inline-flex items-center justify-center h-4 w-4 rounded-full text-[8px] font-semibold',
              style: `width: 16px; height: 16px; background-color: ${colorCode}; color: ${textColor};`,
            },
            initials,
          ];

      return [
        'span',
        {
          ...HTMLAttributes,
          class: 'mention inline-flex items-center align-middle mx-0.5',
          'data-type': 'mention',
          'data-id': userId,
          'data-label': userName,
          'data-image': userImage,
        },
        [
          'span',
          {
            class: 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground border border-muted-foreground/50 cursor-pointer hover:bg-secondary/80 transition-colors',
            onclick: `window.location.href='/${locale}/users/profile/${userId}'`,
          },
          avatarElement,
          [
            'span',
            { class: 'text-sm' },
            userName,
          ],
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
