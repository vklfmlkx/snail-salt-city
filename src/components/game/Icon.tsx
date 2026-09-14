export function Icon({
  name,
}: {
  name: "next" | "book" | "user" | "settings" | "close" | "dice" | "home";
}) {
  const paths = {
    next: "m9 5 7 7-7 7",
    book: "M12 5v16m0-16C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1Z",
    user: "M20 21v-3a8 8 0 0 0-16 0v3M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
    close: "m5 5 14 14M5 19 19 5",
    dice: "m12 2 10 6v8l-10 6-10-6V8Zm0 0v20M2 8l10 6 10-6M2 16l10-10 10 10",
    home: "m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7",
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
