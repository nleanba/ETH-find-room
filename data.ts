import type { rooms as R } from "./rooms.ts";

async function downloadRooms() {
  const data: typeof R = await fetch(
    "https://ethz.ch/bin/ethz/roominfo?path=/rooms",
  )
    .then((r) => r.json());
  localStorage.setItem("roomdata", JSON.stringify(data));
  return data;
}

export async function rooms(): Promise<typeof R> {
  const stored = localStorage.getItem("roomdata");
  if (stored) return JSON.parse(stored);
  return await downloadRooms();
}
