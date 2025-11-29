import { useEffect, useRef } from "react";
import * as d3 from "d3";
import cloud from "d3-cloud";
import { useParams } from "next/navigation";

type TagType = {
  id: number;
  name: string;
  count: number;
};

type TagCloudProps = {
  tags: TagType[];
};

interface CustomWord {
  text: string;
  size: number;
  x?: number;
  y?: number;
  rotate?: number;
  id: number;
}

const MAX_TAGS = 100; // Define the maximum number of tags globally

export const TagCloud = ({ tags }: TagCloudProps) => {
  const { projectId } = useParams();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tags.length) {
      return;
    }

    // Limit the tags array to a maximum of MAX_TAGS
    const limitedTags = tags.slice(0, MAX_TAGS);

    const truncateText = (text: string, maxLength: number) => {
      return text.length > maxLength
        ? `${text.substring(0, maxLength)}...`
        : text;
    };

    const getFillColor = (size: number, maxSize: number) => {
      const percentage = size / maxSize;
      return `hsl(var(--primary) / ${0.3 + 0.7 * percentage})`;
    };

    // const fontFamily = "sans-serif";
    const fontFamily = "'Noto Sans', sans-serif";
    const fontScale = 25;
    const padding = 5;

    const drawCloud = (words: CustomWord[], maxSize: number) => {
      const svgElement = svgRef.current;
      if (!svgElement) return;

      const svg = d3.select(svgElement);
      svg.selectAll("*").remove();

      const width = svgElement.clientWidth;
      const height = svgElement.clientHeight;

      svg
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("font-family", fontFamily)
        .attr("text-anchor", "middle");

      const g = svg
        .append("g")
        .attr("transform", `translate(${width / 2}, ${height / 2})`);

      words.forEach(({ size, x, y, text, id }) => {
        if (x === undefined || y === undefined) {
          console.warn(`Skipping word due to missing coordinates: ${text}`);
          return;
        }

        const fillColor = getFillColor(size, maxSize);
        const truncatedText = truncateText(text, 20);
        const textWidth = size * (truncatedText.length / 2) + size + 20;
        const textHeight = size + 30;

        const wordGroup = g
          .append("foreignObject")
          .attr("x", x - textWidth / 2)
          .attr("y", y - textHeight / 2)
          .attr("width", textWidth)
          .attr("height", textHeight)
          .attr("transform", `rotate(180, ${x}, ${y})`)
          .style("font-size", "0px");

        wordGroup
          .transition()
          .duration(1000)
          .style("font-size", `${size}px`)
          .attr("transform", `rotate(0, ${x}, ${y})`);

        wordGroup
          .append("xhtml:div")
          .attr("class", "tag-cloud-link-container")
          .style("font-family", fontFamily)
          .style("display", "flex")
          .style("align-items", "center")
          .style("justify-content", "center")
          .style("color", fillColor)
          .style("padding", `${size / 1.5}px`)
          .style("height", "100%")
          .html(
            `<a href="/projects/tags/${projectId}/${id}" class="tag-cloud-link">
              <svg xmlns="http://www.w3.org/2000/svg" width="${size / 1.5}" height="${size / 1.5}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-tag"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>
              <span style="margin-left: 4px;">${truncatedText}</span>
            </a>`
          );
      });
    };

    const renderCloud = () => {
      const container = containerRef.current;
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;

      const maxSize =
        Math.sqrt(d3.max(limitedTags, (tag) => tag.count) || 1) * fontScale;

      cloud<CustomWord>()
        .size([width, height])
        .words(
          limitedTags.map((tag) => ({
            text: tag.name,
            size: Math.sqrt(tag.count) * fontScale,
            id: tag.id,
          }))
        )
        .padding(padding)
        .rotate(() => 0)
        .font(fontFamily)
        .fontSize((d) => d.size)
        .spiral("archimedean")
        .on("end", (words) => drawCloud(words, maxSize))
        .start();
    };

    renderCloud();
    window.addEventListener("resize", renderCloud);
    return () => window.removeEventListener("resize", renderCloud);
  }, [tags, projectId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center"
    >
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
};
