/**
 * User actions — reset, delete, export. Prompts for export path before reset/delete.
 */

import { useState } from "react";
import { useUser } from "../context/UserContext";
import { Button } from "./Button";
import {
  apiExportUserHistory,
  apiResetUser,
  apiDeleteUser,
} from "../lib/api";

export function UserActions() {
  const { user, refreshUsers } = useUser();
  const [exportPath, setExportPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const doExport = async (path: string): Promise<boolean> => {
    if (!user || !path.trim()) return false;
    try {
      const data = await apiExportUserHistory(user.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = path.endsWith(".json") ? path : `${path}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const handleExport = async () => {
    if (!user) return;
    setExporting(true);
    setError(null);
    try {
      const data = await apiExportUserHistory(user.id);
      const filename = `${user.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-history-${Date.now()}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleReset = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      if (exportPath.trim()) {
        await doExport(exportPath.trim());
      }
      await apiResetUser(user.id);
      setExportPath("");
      setConfirmReset(false);
      refreshUsers();
      window.location.reload(); // refresh positions
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      if (exportPath.trim()) {
        await doExport(exportPath.trim());
      }
      await apiDeleteUser(user.id);
      setExportPath("");
      setConfirmDelete(false);
      localStorage.removeItem("trader-user-id");
      refreshUsers();
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      <Button variant="secondary" size="sm" onClick={handleExport} disabled={exporting}>
        {exporting ? "…" : "Export"}
      </Button>
      <Button variant="warning" size="sm" onClick={() => setConfirmReset(true)}>
        Reset
      </Button>
      <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
        Delete
      </Button>

      {(confirmReset || confirmDelete) && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => { if (!busy) { setConfirmReset(false); setConfirmDelete(false); setError(null); } }}
        >
          <div
            style={{
              background: "#1e293b",
              padding: "1.5rem",
              borderRadius: "8px",
              border: "1px solid #334155",
              minWidth: 320,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>
              {confirmReset ? "Reset user" : "Delete user"}
            </h3>
            <p style={{ margin: "0 0 1rem", color: "#94a3b8", fontSize: "0.9rem" }}>
              Export trade history to a file before {confirmReset ? "resetting" : "deleting"}?
            </p>
            <input
              type="text"
              placeholder="e.g. matt-history.json (or leave empty to skip)"
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
              style={{
                width: "100%",
                padding: "0.5rem",
                marginBottom: "1rem",
                borderRadius: "6px",
                background: "#0f172a",
                color: "#e2e8f0",
                border: "1px solid #334155",
                boxSizing: "border-box",
              }}
            />
            {error && (
              <p style={{ color: "#f87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => { setConfirmReset(false); setConfirmDelete(false); setError(null); }} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant={confirmDelete ? "danger" : "warning"}
                onClick={confirmReset ? handleReset : handleDelete}
                disabled={busy}
              >
                {busy ? "…" : confirmReset ? "Reset" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
