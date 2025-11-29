export function stringToColorCode(inputString: string): {
  colorCode: string;
  textColor: string;
} {
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

  // Calculate the luminance of the color
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const textColor = luminance < 128 ? "text-white" : "text-black";

  return { colorCode, textColor };
}
