/**
 * Admin page — list all users and positions, edit any field in real time.
 */

import { useState, useEffect, useCallback } from "react";
import {
  apiAdminGetUsers,
  apiAdminGetPositions,
  apiAdminUpdateUser,
  apiAdminUpdatePosition,
  type AdminUserRow,
  type AdminPositionRow,
} from "../lib/api";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.35rem 0.5rem",
  background: "#0f172a",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: "4px",
  fontSize: "0.9rem",
  boxSizing: "border-box",
};

const cellStyle: React.CSSProperties = {
  padding: "0.5rem",
  color: "#e2e8f0",
  borderTop: "1px solid #334155",
};

const thStyle: React.CSSProperties = {
  padding: "0.75rem",
  textAlign: "left",
  fontWeight: 600,
  color: "#94a3b8",
  background: "#0f172a",
};

type Tab = "users" | "positions";

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [positions, setPositions] = useState<AdminPositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const rows = await apiAdminGetUsers();
      setUsers(rows);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const fetchPositions = useCallback(async () => {
    try {
      const rows = await apiAdminGetPositions();
      setPositions(rows);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchUsers(), fetchPositions()]).finally(() => setLoading(false));
  }, [fetchUsers, fetchPositions]);

  const handleUserUpdate = async (id: number, field: keyof AdminUserRow, value: string | number) => {
    try {
      const updated = await apiAdminUpdateUser(id, { [field]: value });
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handlePositionUpdate = async (id: string, field: keyof AdminPositionRow, value: string | number | null) => {
    try {
      const updated = await apiAdminUpdatePosition(id, { [field]: value });
      setPositions((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (loading) {
    return <p style={{ color: "#94a3b8" }}>Loading admin data…</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", width: "100%", minWidth: 0 }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>Table:</span>
        <button
          type="button"
          onClick={() => setTab("users")}
          className={tab === "users" ? "btn btn-toggle active" : "btn btn-toggle"}
          data-active={tab === "users"}
          style={{ padding: "0.35rem 0.75rem" }}
        >
          Users ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("positions")}
          className={tab === "positions" ? "btn btn-toggle active" : "btn btn-toggle"}
          data-active={tab === "positions"}
          style={{ padding: "0.35rem 0.75rem" }}
        >
          Positions ({positions.length})
        </button>
      </div>

      {error && (
        <div style={{ padding: "1rem", background: "#7f1d1d", borderRadius: "8px", color: "#fecaca" }}>{error}</div>
      )}

      {tab === "users" && (
        <section style={{ width: "100%", minWidth: 0, overflowX: "auto" }}>
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Users</h2>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "#1e293b",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>id</th>
                <th style={thStyle}>name</th>
                <th style={thStyle}>created_at</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderTop: "1px solid #334155" }}>
                  <td style={cellStyle}>{u.id}</td>
                  <td style={cellStyle}>
                    <input
                      type="text"
                      value={u.name}
                      onChange={(e) => setUsers((prev) => prev.map((r) => (r.id === u.id ? { ...r, name: e.target.value } : r)))}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== u.name) handleUserUpdate(u.id, "name", v);
                      }}
                      style={inputStyle}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      type="number"
                      value={u.created_at}
                      onChange={(e) =>
                        setUsers((prev) =>
                          prev.map((r) => (r.id === u.id ? { ...r, created_at: Number(e.target.value) || 0 } : r))
                        )
                      }
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (!isNaN(v) && v !== u.created_at) handleUserUpdate(u.id, "created_at", v);
                      }}
                      style={inputStyle}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "positions" && (
        <section style={{ width: "100%", minWidth: 0, overflowX: "auto" }}>
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Positions</h2>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "#1e293b",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>id</th>
                <th style={thStyle}>user</th>
                <th style={thStyle}>user_id</th>
                <th style={thStyle}>coin</th>
                <th style={thStyle}>side</th>
                <th style={thStyle}>entry_price</th>
                <th style={thStyle}>size</th>
                <th style={thStyle}>strategy_id</th>
                <th style={thStyle}>opened_at</th>
                <th style={thStyle}>closed_at</th>
                <th style={thStyle}>exit_price</th>
                <th style={thStyle}>realized_pnl</th>
                <th style={thStyle}>leverage</th>
                <th style={thStyle}>comment</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <EditablePositionRow key={p.id} position={p} onUpdate={handlePositionUpdate} />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function EditablePositionRow({
  position,
  onUpdate,
}: {
  position: AdminPositionRow;
  onUpdate: (id: string, field: keyof AdminPositionRow, value: string | number | null) => void;
}) {
  const [local, setLocal] = useState(position);
  useEffect(() => {
    setLocal(position);
  }, [position]);

  const sync = (field: keyof AdminPositionRow, value: string | number | null) => {
    setLocal((prev) => ({ ...prev, [field]: value }));
    onUpdate(position.id, field, value);
  };

  const numOrNull = (v: string): number | null => (v === "" ? null : Number(v));

  return (
    <tr style={{ borderTop: "1px solid #334155" }}>
      <td style={{ ...cellStyle, fontSize: "0.8rem", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
        {position.id}
      </td>
      <td style={{ ...cellStyle, color: "#94a3b8", fontWeight: 500 }}>
        {position.user_name ?? "-"}
      </td>
      <td style={cellStyle}>
        <input
          type="number"
          value={local.user_id}
          onChange={(e) => setLocal((prev) => ({ ...prev, user_id: Number(e.target.value) || 0 }))}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (!isNaN(v) && v !== position.user_id) sync("user_id", v);
          }}
          style={{ ...inputStyle, width: 70 }}
        />
      </td>
      <td style={cellStyle}>
        <input
          type="text"
          value={local.coin}
          onChange={(e) => setLocal((prev) => ({ ...prev, coin: e.target.value }))}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== position.coin) sync("coin", v);
          }}
          style={{ ...inputStyle, width: 60 }}
        />
      </td>
      <td style={cellStyle}>
        <select
          value={local.side}
          onChange={(e) => sync("side", e.target.value)}
          style={{ ...inputStyle, width: 80 }}
        >
          <option value="long">long</option>
          <option value="short">short</option>
        </select>
      </td>
      <td style={cellStyle}>
        <input
          type="number"
          step="any"
          value={local.entry_price}
          onChange={(e) => setLocal((prev) => ({ ...prev, entry_price: Number(e.target.value) || 0 }))}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (!isNaN(v) && v !== position.entry_price) sync("entry_price", v);
          }}
          style={{ ...inputStyle, width: 90 }}
        />
      </td>
      <td style={cellStyle}>
        <input
          type="number"
          step="any"
          value={local.size}
          onChange={(e) => setLocal((prev) => ({ ...prev, size: Number(e.target.value) || 0 }))}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (!isNaN(v) && v !== position.size) sync("size", v);
          }}
          style={{ ...inputStyle, width: 80 }}
        />
      </td>
      <td style={cellStyle}>
        <input
          type="text"
          value={local.strategy_id}
          onChange={(e) => setLocal((prev) => ({ ...prev, strategy_id: e.target.value }))}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== position.strategy_id) sync("strategy_id", v);
          }}
          style={{ ...inputStyle, width: 90 }}
        />
      </td>
      <td style={cellStyle}>
        <input
          type="number"
          value={local.opened_at}
          onChange={(e) => setLocal((prev) => ({ ...prev, opened_at: Number(e.target.value) || 0 }))}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (!isNaN(v) && v !== position.opened_at) sync("opened_at", v);
          }}
          style={{ ...inputStyle, width: 110 }}
        />
      </td>
      <td style={cellStyle}>
        <input
          type="number"
          value={local.closed_at ?? ""}
          onChange={(e) => setLocal((prev) => ({ ...prev, closed_at: numOrNull(e.target.value) }))}
          onBlur={(e) => {
            const v = numOrNull(e.target.value);
            if (v !== position.closed_at) sync("closed_at", v);
          }}
          placeholder="—"
          style={{ ...inputStyle, width: 110 }}
        />
      </td>
      <td style={cellStyle}>
        <input
          type="number"
          step="any"
          value={local.exit_price ?? ""}
          onChange={(e) => setLocal((prev) => ({ ...prev, exit_price: numOrNull(e.target.value) }))}
          onBlur={(e) => {
            const v = numOrNull(e.target.value);
            if (v !== position.exit_price) sync("exit_price", v);
          }}
          placeholder="—"
          style={{ ...inputStyle, width: 90 }}
        />
      </td>
      <td style={cellStyle}>
        <input
          type="number"
          step="any"
          value={local.realized_pnl ?? ""}
          onChange={(e) => setLocal((prev) => ({ ...prev, realized_pnl: numOrNull(e.target.value) }))}
          onBlur={(e) => {
            const v = numOrNull(e.target.value);
            if (v !== position.realized_pnl) sync("realized_pnl", v);
          }}
          placeholder="—"
          style={{ ...inputStyle, width: 90 }}
        />
      </td>
      <td style={cellStyle}>
        <input
          type="number"
          value={local.leverage ?? ""}
          onChange={(e) => setLocal((prev) => ({ ...prev, leverage: numOrNull(e.target.value) }))}
          onBlur={(e) => {
            const v = numOrNull(e.target.value);
            if (v !== position.leverage) sync("leverage", v);
          }}
          placeholder="—"
          style={{ ...inputStyle, width: 70 }}
        />
      </td>
      <td style={cellStyle}>
        <input
          type="text"
          value={local.comment ?? ""}
          onChange={(e) => setLocal((prev) => ({ ...prev, comment: e.target.value || null }))}
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== (position.comment ?? "")) sync("comment", v);
          }}
          placeholder="—"
          style={{ ...inputStyle, width: 120 }}
        />
      </td>
    </tr>
  );
}
