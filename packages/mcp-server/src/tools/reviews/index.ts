import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReviewsDecide, type ReviewsDecideDeps } from "./decide.js";
import { registerReviewsList, type ReviewsListDeps } from "./list.js";

export type ReviewsDeps = ReviewsListDeps & ReviewsDecideDeps;

export function registerReviews(server: McpServer, deps: ReviewsDeps): void {
  registerReviewsList(server, deps);
  registerReviewsDecide(server, deps);
}

export { registerReviewsList, registerReviewsDecide };
export type { ReviewsListDeps, ReviewsDecideDeps };
