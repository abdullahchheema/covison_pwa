// Inline stroke icons (Lucide-style geometry, drawn locally; no icon font or
// CDN). Each icon is a list of SVG child elements on a 24x24 grid.
import type { JSX } from "preact";

type El = ["path", string] | ["circle", number, number, number] | ["rect", number, number, number, number, number];

const I: Record<string, El[]> = {
  home: [["path", "M3 10.5 12 3l9 7.5"], ["path", "M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"]],
  users: [["circle", 9, 8, 4], ["path", "M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"], ["path", "M16 3.5a4 4 0 0 1 0 8"], ["path", "M22 21v-1a6 6 0 0 0-4-5.6"]],
  user: [["circle", 12, 8, 4.5], ["path", "M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1"]],
  pipeline: [["rect", 3, 4, 5, 16, 1.5], ["rect", 10, 4, 5, 11, 1.5], ["rect", 17, 4, 4, 7, 1.5]],
  tasks: [["path", "M9 11l3 3 8-8"], ["path", "M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"]],
  grid: [["rect", 3, 3, 7.5, 7.5, 2], ["rect", 13.5, 3, 7.5, 7.5, 2], ["rect", 3, 13.5, 7.5, 7.5, 2], ["rect", 13.5, 13.5, 7.5, 7.5, 2]],
  plus: [["path", "M12 5v14"], ["path", "M5 12h14"]],
  chevronRight: [["path", "m9 6 6 6-6 6"]],
  chevronLeft: [["path", "m15 6-6 6 6 6"]],
  chevronDown: [["path", "m6 9 6 6 6-6"]],
  search: [["circle", 11, 11, 7], ["path", "m20 20-3.5-3.5"]],
  phone: [["path", "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"]],
  message: [["path", "M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.9-.9L3 21l1.9-4.7A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z"]],
  mail: [["rect", 3, 5, 18, 14, 2], ["path", "m3 7 9 6 9-6"]],
  globe: [["circle", 12, 12, 9], ["path", "M3 12h18"], ["path", "M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"]],
  building: [["rect", 4, 3, 16, 18, 2], ["path", "M9 21v-4h6v4"], ["path", "M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01"]],
  dollar: [["path", "M12 2v20"], ["path", "M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"]],
  calendar: [["rect", 3, 4.5, 18, 16.5, 2.5], ["path", "M3 9.5h18"], ["path", "M8 2.5v4M16 2.5v4"]],
  tag: [["path", "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"], ["circle", 7.5, 7.5, 1.5]],
  layers: [["path", "m12 2 10 5-10 5L2 7l10-5Z"], ["path", "m2 17 10 5 10-5"], ["path", "m2 12 10 5 10-5"]],
  folder: [["path", "M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"]],
  chart: [["path", "M3 3v18h18"], ["path", "M8 16v-5"], ["path", "M13 16V8"], ["path", "M18 16v-9"]],
  settings: [["circle", 12, 12, 3], ["path", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"]],
  trash: [["path", "M3 6h18"], ["path", "M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"], ["path", "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"], ["path", "M10 11v6M14 11v6"]],
  edit: [["path", "M12 20h9"], ["path", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"]],
  x: [["path", "M18 6 6 18"], ["path", "m6 6 12 12"]],
  check: [["path", "m5 12.5 4.5 4.5L19 7.5"]],
  checkCircle: [["circle", 12, 12, 9.5], ["path", "m8 12.5 3 3 5-6"]],
  circle: [["circle", 12, 12, 9.5]],
  alert: [["path", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"], ["path", "M12 9v4"], ["path", "M12 17h.01"]],
  download: [["path", "M12 3v12"], ["path", "m7 10 5 5 5-5"], ["path", "M5 21h14"]],
  upload: [["path", "M12 21V9"], ["path", "m7 14 5-5 5 5"], ["path", "M5 3h14"]],
  share: [["path", "M12 3v12"], ["path", "m8 7 4-4 4 4"], ["path", "M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"]],
  sun: [["circle", 12, 12, 4], ["path", "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"]],
  moon: [["path", "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"]],
  note: [["path", "M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"], ["path", "M15 3v5h5"], ["path", "M8 13h8M8 17h5"]],
  clock: [["circle", 12, 12, 9.5], ["path", "M12 7v5l3 2"]],
  link: [["path", "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"], ["path", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"]],
  sparkles: [["path", "M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z"], ["path", "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"]],
  arrowUpRight: [["path", "M7 17 17 7"], ["path", "M8 7h9v9"]],
  more: [["circle", 5, 12, 1.4], ["circle", 12, 12, 1.4], ["circle", 19, 12, 1.4]],
  refresh: [["path", "M3 12a9 9 0 0 1 15.5-6.2L21 8"], ["path", "M21 3v5h-5"], ["path", "M21 12a9 9 0 0 1-15.5 6.2L3 16"], ["path", "M3 21v-5h5"]],
  shield: [["path", "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"], ["path", "m9 12 2 2 4-4"]],
  database: [["path", "M3 5c0-1.7 4-3 9-3s9 1.3 9 3-4 3-9 3-9-1.3-9-3Z"], ["path", "M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"], ["path", "M3 12c0 1.7 4 3 9 3s9-1.3 9-3"]],
  file: [["path", "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"], ["path", "M14 3v6h6"]],
  meeting: [["circle", 8, 9, 3], ["circle", 16, 9, 3], ["path", "M2 20a6 6 0 0 1 12 0"], ["path", "M10 20a6 6 0 0 1 12 0"]],
  flag: [["path", "M4 22V4"], ["path", "M4 4h13l-2 4 2 4H4"]],
  trend: [["path", "m3 17 6-6 4 4 8-8"], ["path", "M14 7h7v7"]],
  hand: [["path", "M18 11V6a2 2 0 0 0-4 0v5"], ["path", "M14 10V4a2 2 0 0 0-4 0v6"], ["path", "M10 10.5V6a2 2 0 0 0-4 0v8"], ["path", "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"]],
  move: [["path", "M5 9 2 12l3 3"], ["path", "M9 5l3-3 3 3"], ["path", "M15 19l-3 3-3-3"], ["path", "M19 9l3 3-3 3"], ["path", "M2 12h20"], ["path", "M12 2v20"]],
  info: [["circle", 12, 12, 9.5], ["path", "M12 16v-4"], ["path", "M12 8h.01"]],
  wifiOff: [["path", "m2 2 20 20"], ["path", "M8.5 16.4a5 5 0 0 1 7 0"], ["path", "M2 8.8a15 15 0 0 1 4.2-2.6"], ["path", "M10.7 5.1A15 15 0 0 1 22 8.8"], ["path", "M5 12.9a10 10 0 0 1 5.2-2.8"], ["path", "M16.8 11.2a10 10 0 0 1 2.2 1.7"], ["path", "M12 20h.01"]],
  columns: [["rect", 3, 3, 18, 18, 2], ["path", "M9 3v18M15 3v18"]],
  arrowLeft: [["path", "M19 12H5"], ["path", "m12 19-7-7 7-7"]],
  arrowDownLeft: [["path", "M17 7 7 17"], ["path", "M16 17H7V8"]],
  whatsapp: [
    ["path", "M3.2 20.8l1.3-4.2A9 9 0 1 1 8 19.9Z"],
    ["path", "M9 8.6c.2-.5.6-.6 1-.6h.5l.9 2.1-.7.9a5.6 5.6 0 0 0 2.6 2.6l.9-.7 2.1.9v.5c0 .4-.1.8-.6 1-1.2.6-3.2.1-4.9-1.6S8.4 9.8 9 8.6Z"],
  ],
  wallet: [["path", "M19 7V5.5A1.5 1.5 0 0 0 17.5 4H5a2 2 0 0 0 0 4h14a1 1 0 0 1 1 1v3"], ["path", "M3 6v12a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"], ["path", "M21 12v4h-4a2 2 0 0 1 0-4Z"]],
  handshake: [["path", "m11 17 2 2a1 1 0 1 0 3-3"], ["path", "m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a3 3 0 0 0-4.2 0l-.9.9a1 1 0 1 1-3-3l2.8-2.8a5.8 5.8 0 0 1 7.1-.9l.5.3a2 2 0 0 0 1.4.3L21 5"], ["path", "m21 3 1 11h-2"], ["path", "M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"], ["path", "M3 4h8"]],
  arrowRight: [["path", "M5 12h14"], ["path", "m12 5 7 7-7 7"]],
};

export type IconName = keyof typeof I;

export function Icon({
  name,
  size = 22,
  stroke = 2,
  class: cls,
  fill,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  class?: string;
  fill?: string;
}): JSX.Element {
  const els = I[name] ?? [];
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ?? "none"}
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {els.map((e, i) => {
        if (e[0] === "path") return <path key={i} d={e[1]} />;
        if (e[0] === "circle") return <circle key={i} cx={e[1]} cy={e[2]} r={e[3]} />;
        return <rect key={i} x={e[1]} y={e[2]} width={e[3]} height={e[4]} rx={e[5]} />;
      })}
    </svg>
  );
}
