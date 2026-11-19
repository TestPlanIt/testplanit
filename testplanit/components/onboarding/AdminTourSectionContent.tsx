import { Badge } from "@/components/ui/badge";

/** An admin tour step's body: what the section is for, then its pages. */
export function AdminTourSectionContent({
  description,
  pages,
}: {
  description: string;
  pages: string[];
}) {
  return (
    <div className="space-y-2">
      <p>{description}</p>
      <ul className="flex flex-wrap gap-1">
        {pages.map((page) => (
          <li key={page}>
            <Badge variant="secondary">{page}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
