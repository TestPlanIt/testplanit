import { contrastingTextColor } from "~/utils/contrastingTextColor";

/**
 * A stable colour for a name — avatar circles, chart series, mention chips.
 *
 * `colorCode` is a hash, so it is identity: the same name always gets the same
 * colour, and changing the mapping would repaint every avatar in every install.
 * It is deliberately left alone.
 *
 * `textColor` is a Tailwind class because `Avatar` applies it with `className`.
 * It uses the strict better-of-black-or-white pick, which never drops below
 * 4.58:1 on any possible background — the same pick every status surface now
 * takes.
 */
export function stringToColorCode(inputString: string): {
  colorCode: string;
  textColor: string;
} {
  let hash = 0;
  for (let i = 0; i < inputString.length; i++) {
    hash = inputString.charCodeAt(i) + ((hash << 5) - hash);
  }
  let colorCode = "#";

  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    colorCode += ("00" + value.toString(16)).substr(-2);
  }

  return { colorCode, textColor: textColorClassFor(colorCode) };
}

/**
 * The readable Tailwind text class for any background colour.
 *
 * The Tiptap mention extension reaches the same answer by calling
 * `contrastingTextColor` directly. It used to carry its own copy of the hash
 * and of a luminance pick that summed raw channels with red and blue
 * transposed, which put 14.2% of generated colours below 4.5:1.
 */
export function textColorClassFor(backgroundColor: string): string {
  return contrastingTextColor(backgroundColor) === "#ffffff"
    ? "text-white"
    : "text-black";
}
