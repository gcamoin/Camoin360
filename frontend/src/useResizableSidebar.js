import { useState } from "react";
import { Box } from "@mui/material";

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 260;
const MAX_WIDTH = 520;

export function useResizableSidebar(dashboardKey) {
  const storageKey = `camoin360:${dashboardKey}SidebarWidth`;
  const [width, setWidth] = useState(() => {
    const storedWidth = window.localStorage.getItem(storageKey);
    if (storedWidth === null) return DEFAULT_WIDTH;
    const parsedWidth = Number(storedWidth);
    return Number.isFinite(parsedWidth)
      ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsedWidth))
      : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  function startResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    setIsResizing(true);

    function getNextWidth(clientX) {
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + clientX - startX));
    }

    function handlePointerMove(moveEvent) {
      setWidth(getNextWidth(moveEvent.clientX));
    }

    function handlePointerUp(upEvent) {
      const finalWidth = getNextWidth(upEvent.clientX);
      setWidth(finalWidth);
      setIsResizing(false);
      window.localStorage.setItem(storageKey, String(finalWidth));
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function resetWidth() {
    setWidth(DEFAULT_WIDTH);
    window.localStorage.setItem(storageKey, String(DEFAULT_WIDTH));
  }

  return { isResizing, resetWidth, startResize, width };
}

export function SidebarResizeHandle({ isResizing, onReset, onResizeStart }) {
  return (
    <Box
      aria-label="Resize dashboard navigation"
      onDoubleClick={onReset}
      onPointerDown={onResizeStart}
      role="separator"
      sx={{
        bottom: 0,
        cursor: "col-resize",
        position: "absolute",
        right: 0,
        top: 0,
        touchAction: "none",
        width: 10,
        zIndex: 2,
        "&::after": {
          backgroundColor: isResizing ? "secondary.light" : "transparent",
          bottom: 0,
          content: '\"\"',
          position: "absolute",
          right: 0,
          top: 0,
          transition: isResizing ? "none" : "background-color 120ms ease",
          width: isResizing ? 4 : 2,
        },
        "&:hover::after": {
          backgroundColor: "secondary.main",
        },
      }}
      tabIndex={-1}
      title="Drag to resize; double-click to reset"
    />
  );
}
