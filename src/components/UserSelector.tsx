/**
 * User selector — pick or create user by name.
 */

import { useState } from "react";
import { useUser } from "../context/UserContext";
import { Button } from "./Button";

export function UserSelector() {
  const { user, users, loading, error, selectUser, createOrSelectUser } = useUser();
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const name = input.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createOrSelectUser(name);
      setInput("");
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <span style={{ color: "#94a3b8" }}>Loading users…</span>;
  }

  if (error) {
    return (
      <span style={{ color: "#f87171" }}>
        Cannot reach API: {error}. Start the backend with <code>make dev</code>.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>User:</span>
      <select
        value={user?.id ?? ""}
        onChange={(e) => {
          const id = e.target.value ? parseInt(e.target.value, 10) : null;
          const u = users.find((x) => x.id === id);
          if (u) selectUser(u);
        }}
        style={{
          padding: "0.35rem 0.5rem",
          borderRadius: "6px",
          background: "#1e293b",
          color: "#e2e8f0",
          border: "1px solid #334155",
          minWidth: "100px",
        }}
      >
        <option value="">— Select —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: "0.25rem" }}>
        <input
          type="text"
          placeholder="New user name"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          style={{
            width: "120px",
            padding: "0.35rem 0.5rem",
            borderRadius: "6px",
            background: "#1e293b",
            color: "#e2e8f0",
            border: "1px solid #334155",
            fontSize: "0.9rem",
          }}
        />
        <Button variant="secondary" size="sm" onClick={handleCreate} disabled={!input.trim() || creating}>
          {creating ? "…" : "Add"}
        </Button>
      </div>
    </div>
  );
}
