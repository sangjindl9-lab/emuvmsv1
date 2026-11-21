"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, Empty, Field, Modal, Spinner } from "./ui";

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "select" | "textarea" | "checkbox" | "date" | "password" | "json";
  options?: { value: string; label: string }[];
  optionsFrom?: { endpoint: string; valueKey: string; labelKey: string; filterKey?: string };
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  help?: string;
  hiddenOnEdit?: boolean;
  full?: boolean;
};

export type ColumnDef = {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>) => ReactNode;
  width?: string;
};

export function ResourceManager({
  title,
  endpoint,
  columns,
  fields,
  createLabel = "신규 등록",
  updateEndpoint,
  deleteEndpoint,
  canWrite = true,
  searchPlaceholder = "검색",
  exportPath,
  extraActions,
  filters,
  onRowClick,
  onCreated,
  emptyText = "데이터가 없습니다.",
}: {
  title: string;
  endpoint: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  createLabel?: string;
  updateEndpoint?: (row: Record<string, unknown>) => string;
  deleteEndpoint?: (row: Record<string, unknown>) => string | null;
  canWrite?: boolean;
  searchPlaceholder?: string;
  exportPath?: string;
  extraActions?: ReactNode;
  filters?: ReactNode;
  onRowClick?: (row: Record<string, unknown>) => void;
  onCreated?: (result: unknown) => void;
  emptyText?: string;
}) {
  const { data, error, loading, reload } = useApi<{ items: Record<string, unknown>[] }>(endpoint);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Record<string, { value: string; label: string }[]>>({});

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  }, [items, search]);

  useEffect(() => {
    const sources = fields.filter((f) => f.optionsFrom);
    for (const field of sources) {
      const src = field.optionsFrom!;
      void api<{ items: Record<string, unknown>[] }>(src.endpoint)
        .then((result) => {
          const list = (result.items ?? []).map((row) => {
            const raw = row[src.valueKey];
            return { value: String(raw ?? ""), label: String(row[src.labelKey] ?? raw ?? "") };
          });
          setOptions((prev) => ({ ...prev, [field.key]: list }));
        })
        .catch(() => setOptions((prev) => ({ ...prev, [field.key]: [] })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, fields.length]);

  const openCreate = () => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      if (field.defaultValue !== undefined) initial[field.key] = String(field.defaultValue);
      else if (field.type === "checkbox") initial[field.key] = "false";
    }
    setForm(initial);
    setEditing(null);
    setFormError(null);
    setModal("create");
  };

  const openEdit = (row: Record<string, unknown>) => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      const value = row[field.key];
      initial[field.key] = value === null || value === undefined ? "" : String(value);
    }
    setForm(initial);
    setEditing(row);
    setFormError(null);
    setModal("edit");
  };

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        if (modal === "edit" && field.hiddenOnEdit) continue;
        const value = form[field.key] ?? "";
        if (field.type === "checkbox") payload[field.key] = value === "true";
        else if (field.type === "number") payload[field.key] = value === "" ? null : Number(value);
        else if (field.type === "json") payload[field.key] = value ? JSON.parse(value) : null;
        else payload[field.key] = value === "" ? null : value;
      }
      if (modal === "create") {
        const result = await api(endpoint, { method: "POST", body: payload });
        onCreated?.(result);
      } else if (editing) {
        const path = updateEndpoint ? updateEndpoint(editing) : `${endpoint}/${String(editing.id)}`;
        await api(path, { method: "PATCH", body: payload });
      }
      setModal(null);
      await reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: Record<string, unknown>) => {
    if (!deleteEndpoint) return;
    const path = deleteEndpoint(row);
    if (!path) return;
    if (!confirm("비활성/삭제 처리하시겠습니까?")) return;
    try {
      await api(path, { method: "DELETE" });
      await reload();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <Card
        title={title}
        actions={
          <>
            {extraActions}
            {exportPath ? (
              <a className="eum-btn" href={`/api/v1/${exportPath}`} download>
                CSV 내보내기
              </a>
            ) : null}
            {canWrite ? (
              <Button variant="primary" onClick={openCreate}>
                + {createLabel}
              </Button>
            ) : null}
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input className="eum-input max-w-[260px]" placeholder={searchPlaceholder} value={search} onChange={(event) => setSearch(event.target.value)} />
          {filters}
          <span className="text-[11px] text-[var(--eum-muted)]">{filtered.length}건</span>
        </div>
        {error ? <Alert kind="error">{error}</Alert> : null}
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <Empty>{emptyText}</Empty>
        ) : (
          <div className="eum-scroll max-h-[65vh]">
            <table className="eum-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} style={{ width: column.width }}>
                      {column.label}
                    </th>
                  ))}
                  <th className="w-[110px]">관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={String(row.id)} className={onRowClick ? "cursor-pointer" : ""} onClick={() => onRowClick?.(row)}>
                    {columns.map((column) => (
                      <td key={column.key}>{column.render ? column.render(row) : String(row[column.key] ?? "-")}</td>
                    ))}
                    <td onClick={(event) => event.stopPropagation()}>
                      {canWrite ? (
                        <div className="flex gap-1">
                          <button className="text-[11px] text-[var(--eum-accent)] hover:underline" onClick={() => openEdit(row)}>
                            수정
                          </button>
                          {deleteEndpoint ? (
                            <button className="text-[11px] text-[#e58a80] hover:underline" onClick={() => void remove(row)}>
                              삭제
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[10px] text-[var(--eum-muted)]">조회</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {modal ? (
        <Modal title={modal === "create" ? `${title} ${createLabel}` : `${title} 수정`} onClose={() => setModal(null)}>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields
              .filter((field) => !(modal === "edit" && field.hiddenOnEdit))
              .map((field) => {
                const optionsList = field.options ?? options[field.key] ?? [];
                return (
                  <div key={field.key} className={field.full || field.type === "textarea" || field.type === "json" ? "sm:col-span-2" : ""}>
                    <Field label={`${field.label}${field.required ? " *" : ""}`} hint={field.help}>
                      {field.type === "select" ? (
                        <select className="eum-input" value={form[field.key] ?? ""} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}>
                          <option value="">선택</option>
                          {optionsList.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : field.type === "textarea" || field.type === "json" ? (
                        <textarea
                          className="eum-input min-h-[90px] font-mono"
                          value={form[field.key] ?? ""}
                          placeholder={field.placeholder}
                          onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                        />
                      ) : field.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[#23c3e6]"
                          checked={form[field.key] === "true"}
                          onChange={(event) => setForm({ ...form, [field.key]: String(event.target.checked) })}
                        />
                      ) : (
                        <input
                          className="eum-input"
                          type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "password" ? "password" : "text"}
                          value={form[field.key] ?? ""}
                          placeholder={field.placeholder}
                          onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                );
              })}
          </div>
          {formError ? <div className="mt-3"><Alert kind="error">{formError}</Alert></div> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setModal(null)}>취소</Button>
            <Button variant="primary" onClick={() => void submit()} disabled={busy}>
              {busy ? "저장 중…" : "저장"}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  return <Badge value={value} />;
}
