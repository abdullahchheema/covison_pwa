// CSV import sheet with column mapping, ported from the web importer.
import { useState } from "preact/hooks";
import { csvToObjects } from "../db/csv";
import { MAX_ROWS, TARGETS, guessMapping, importPrepared, prepareRows, type Entity } from "../db/csvImport";
import { Group, SelectField } from "../ui/kit";
import { openSheet, toast } from "../ui/overlay";
import { Icon } from "../ui/icons";

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    input.click();
  });
}

export async function openCsvImport(entity: Entity) {
  const [file] = await pickFile(".csv,text/csv");
  if (!file) return;
  if (file.size > 5_000_000) {
    toast("That file is over 5 MB", { error: true });
    return;
  }
  const { headers, rows } = csvToObjects(await file.text());
  if (!headers.length || !rows.length) {
    toast("No rows found. The first row must be a header.", { error: true });
    return;
  }
  const bind: { current: (() => Promise<boolean | void>) | null } = { current: null };
  openSheet(() => <Mapper entity={entity} headers={headers} rows={rows} fileName={file.name} bind={bind} />, {
    title: `Import ${entity}`,
    full: true,
    done: { label: "Import", run: () => bind.current?.() },
  });
}

function Mapper({
  entity,
  headers,
  rows,
  fileName,
  bind,
}: {
  entity: Entity;
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
  bind: { current: (() => Promise<boolean | void>) | null };
}) {
  const [mapping, setMapping] = useState(() => guessMapping(entity, headers));
  const prepared = mapping.name ? prepareRows(entity, rows, mapping) : [];
  const valid = prepared.filter((r) => !r.error);
  const invalid = prepared.filter((r) => r.error);

  bind.current = async () => {
    if (!mapping.name) {
      toast("Map a column to Name first", { error: true });
      return false;
    }
    if (!valid.length) {
      toast("No valid rows to import", { error: true });
      return false;
    }
    const res = await importPrepared(entity, prepared);
    toast(`Imported ${res.created} new, updated ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ""}`, { ms: 4000 });
  };

  return (
    <div class="form">
      <div class="banner brand">
        <Icon name="file" size={20} class="b-ico" />
        <span class="grow">
          <strong class="truncate" style="display:block">{fileName}</strong>
          <span class="t-footnote c2">
            {rows.length} rows{rows.length > MAX_ROWS ? ` (first ${MAX_ROWS} used)` : ""}
          </span>
        </span>
      </div>
      <Group label="Match columns" footer="Existing contacts with the same email, and companies with the same name, are updated instead of duplicated.">
        {TARGETS[entity].map((t) => (
          <SelectField
            key={t.key}
            label={t.required ? `${t.label} *` : t.label}
            value={mapping[t.key] ?? ""}
            placeholder="Skip"
            onChange={(v) => setMapping((m) => ({ ...m, [t.key]: v }))}
            options={headers.map((h) => ({ value: h, label: h }))}
          />
        ))}
      </Group>
      {mapping.name && (
        <Group label={`Preview · ${valid.length} ready${invalid.length ? ` · ${invalid.length} with problems` : ""}`}>
          {prepared.slice(0, 8).map((r, i) => (
            <div class="lrow" key={i}>
              <div class="grow col">
                <span class="lr-title truncate">{r.values.name || "—"}</span>
                <span class="lr-sub truncate">{[r.values.email, r.values.company ?? r.values.industry, r.values.status].filter(Boolean).join(" · ")}</span>
              </div>
              {r.error ? <span class="badge danger">{r.error}</span> : <Icon name="check" size={18} class="c-success" />}
            </div>
          ))}
        </Group>
      )}
    </div>
  );
}
