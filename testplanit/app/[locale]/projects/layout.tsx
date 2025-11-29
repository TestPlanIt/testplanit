"use client";

import ProjectMenu from "@/components/ProjectMenu";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "~/lib/navigation";

export default function ProjectsLayout(props: any) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load initial state from localStorage
  useEffect(() => {
    const savedCollapsed = localStorage.getItem("projectMenuCollapsed");
    if (savedCollapsed !== null) {
      setIsCollapsed(savedCollapsed === "true");
    }
  }, []);

  // Save state to localStorage when it changes
  const handleToggleCollapse = () => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    localStorage.setItem("projectMenuCollapsed", newCollapsed.toString());
  };

  return (
    <div className="flex" id="project-menu">
      <div className="relative">
        <div
          className={`sticky w-[57px] ${!isCollapsed ? "md:w-[225px]" : ""} top-0 z-10 h-screen transition-all duration-300`}
        >
          <ProjectMenu
            isCollapsed={isCollapsed}
            onToggleCollapse={handleToggleCollapse}
          />
        </div>
        <Button
          type="button"
          onClick={handleToggleCollapse}
          variant="secondary"
          className="hidden md:flex absolute -right-4 top-12 z-20 p-0 rounded-l-none"
        >
          {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
        </Button>
      </div>
      <div className="ml-4 w-full overflow-x-hidden">{props.children}</div>
    </div>
  );
}
