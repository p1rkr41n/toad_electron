import * as React from "react";
import { useState, useRef, useCallback, useEffect } from "react";
import * as actions from "../actions";

export interface SidebarProps {
  expanded: boolean;
  children: JSX.Element[] | JSX.Element;
  initialWidth?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  expanded,
  children,
  initialWidth = 340,
}) => {
  const [width, setWidth] = useState<number>(initialWidth);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(initialWidth);
  const cleanupFnRef = useRef<(() => void) | null>(null);

  const stopResizing = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.dispatchEvent(new Event("resize"));
  }, []);

  // Safety lifecycle guard: ensure listeners and body styles are cleaned up on unmount
  useEffect(() => {
    return () => {
      if (cleanupFnRef.current) {
        cleanupFnRef.current();
        cleanupFnRef.current = null;
      }
      if (isDraggingRef.current) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = moveEvent.clientX - startXRef.current;
        const maxWidth = Math.min(window.innerWidth * 0.75, 850);
        const newWidth = Math.max(220, Math.min(maxWidth, startWidthRef.current + delta));
        setWidth(newWidth);
        window.dispatchEvent(new Event("resize"));
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        window.removeEventListener("blur", handleMouseUp);
        document.removeEventListener("mouseleave", handleMouseUp);
        cleanupFnRef.current = null;
        stopResizing();
      };

      cleanupFnRef.current = handleMouseUp;

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("blur", handleMouseUp);
      document.addEventListener("mouseleave", handleMouseUp);
    },
    [width, stopResizing]
  );

  const handleDoubleClick = useCallback(() => {
    setWidth(initialWidth);
    window.dispatchEvent(new Event("resize"));
  }, [initialWidth]);

  const expandClass = expanded ? "sidebar-expanded" : "sidebar-collapsed";
  const resizingClass = isResizing ? " is-resizing" : "";

  return (
    <div
      className={"sidebar " + expandClass + resizingClass}
      style={expanded ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
    >
      <div className="sidebar-content">
        <div className="sidebar-content-inner">{children}</div>
      </div>
      {expanded && (
        <div
          className={`sidebar-resizer${resizingClass}`}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          title="Drag to resize panel (Double-click to reset width)"
        />
      )}
    </div>
  );
};

