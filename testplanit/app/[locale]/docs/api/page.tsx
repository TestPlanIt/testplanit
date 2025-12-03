/* eslint-disable react/jsx-no-literals */
"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";
import "~/styles/swagger-ui-custom.css";

// Dynamic import to avoid SSR issues
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

const API_CATEGORIES = [
  {
    id: "custom",
    title: "Custom API Endpoints",
    description:
      "Authentication, file uploads, imports, and other custom endpoints",
  },
  {
    id: "projects",
    title: "Projects & Folders",
    description: "Project and folder management",
  },
  {
    id: "testCases",
    title: "Test Cases & Repository",
    description: "Test case management and repository operations",
  },
  {
    id: "testRuns",
    title: "Test Runs & Execution",
    description: "Test run management and execution tracking",
  },
  {
    id: "planning",
    title: "Planning & Organization",
    description: "Milestones, configurations, tags, workflows, and statuses",
  },
  {
    id: "users",
    title: "Users & Accounts",
    description: "User management, roles, groups, and account settings",
  },
  {
    id: "integrations",
    title: "Integrations & SSO",
    description: "External integrations, SSO, and AI/LLM features",
  },
  {
    id: "other",
    title: "Attachments & Other",
    description: "File attachments, comments, imports, and miscellaneous",
  },
];

export default function ApiDocsPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  if (!selectedCategory) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-2 text-3xl font-bold">
            TestPlanIt API Documentation
          </h1>
          <p className="mb-8 text-muted-foreground">
            Select an API category to view its documentation.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            {API_CATEGORIES.map((category) => (
              <button
                type="button"
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className="rounded-lg border bg-card p-6 text-left transition-colors hover:bg-accent"
              >
                <h2 className="mb-2 text-xl font-semibold">{category.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {category.description}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const category = API_CATEGORIES.find((c) => c.id === selectedCategory);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card p-4">
        <div className="mx-auto flex max-w-7xl items-center gap-4">
          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            className="rounded-md bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80"
          >
            ← Back to Categories
          </button>
          <div>
            <h1 className="text-lg font-semibold">{category?.title}</h1>
            <p className="text-sm text-muted-foreground">
              {category?.description}
            </p>
          </div>
        </div>
      </div>
      <SwaggerUI url={`/api/docs?category=${selectedCategory}`} />
    </div>
  );
}
