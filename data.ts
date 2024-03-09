import type { rooms as R } from "./rooms.ts";
import { RoomInfo, Timeslot, TimeslotJSON } from "./types.ts";
import * as datetime from "https://deno.land/std@0.192.0/datetime/mod.ts";

type StoredData = {
  [datequery: string]: { // week descriptor
    [building: string]: {
      [floor: string]: {
        [room: string]: Timeslot[];
      };
    };
  };
};

let storedData: StoredData = {};
let uninitialized = true;

async function downloadRooms() {
  const data: typeof R = await fetch(
    "https://ethz.ch/bin/ethz/roominfo?path=/rooms",
  )
    .then((r) => r.json());
  localStorage.setItem(
    "roomdata",
    JSON.stringify(data.filter((r) => r.type !== "Ausstellungsfläche")),
  );
  return data;
}

export async function rooms(): Promise<typeof R> {
  const stored = localStorage.getItem("roomdata");
  if (stored) return JSON.parse(stored).filter((r) => r.type !== "Ausstellungsfläche");
  return await downloadRooms();
}

let inflight = 0;
async function downloadTimeslots(
  room: RoomInfo,
  DATEQUERY: string,
): Promise<Timeslot[]> {
  // sometimes week-long events get missed if only a single day is queried
  const url = `https://ethz.ch/bin/ethz/roominfo?path=/rooms/${
    encodeURIComponent(`${room.building} ${room.floor} ${room.room}`)
  }/allocations${DATEQUERY}`;

  console.log(`Querying ${url}.`);

  let json: TimeslotJSON[];

  while (inflight > 8) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  inflight++;

  try {
    json = await fetch(url).then((r) => r.json());
  } catch (error) {
    console.warn("retrying", error);
    json = await new Promise<TimeslotJSON[]>((resolve) =>
      setTimeout(() => {
        return resolve(fetch(url).then((r) => r.json()));
      }, 500)
    );
  }

  inflight--;

  const data: Timeslot[] = json.map((t) => {
    return {
      ...t,
      date_from: datetime.parse(t.date_from, "yyyy-MM-ddTHH:mm:ss").getTime(),
      date_to: datetime.parse(t.date_to, "yyyy-MM-ddTHH:mm:ss").getTime(),
    };
  });

  if (!storedData[DATEQUERY]) storedData[DATEQUERY] = {};
  if (!storedData[DATEQUERY][room.building]) {
    storedData[DATEQUERY][room.building] = {};
  }
  if (!storedData[DATEQUERY][room.building][room.floor]) {
    storedData[DATEQUERY][room.building][room.floor] = {};
  }

  storedData[DATEQUERY][room.building][room.floor][room.room] = data;

  try {
    localStorage.setItem("roomdata_ts", JSON.stringify(storedData));
  } catch (e) {
    if (e instanceof DOMException) {
      const stored = localStorage.getItem("roomdata");
      const data = Object.entries(storedData);
      storedData = Object.fromEntries(data.sort().slice(-3));
      localStorage.clear();
      localStorage.setItem("roomdata", JSON.stringify(stored));
      localStorage.setItem("roomdata_ts", JSON.stringify(storedData));
    } else throw e;
  }

  return data;
}

export async function getTimeslots(
  room: RoomInfo,
  DATEQUERY: string,
): Promise<Timeslot[]> {
  if (uninitialized) {
    const stored = localStorage.getItem("roomdata_ts");
    if (stored) storedData = JSON.parse(stored);
    uninitialized = false;
  }

  const data = storedData[DATEQUERY]?.[room.building]?.[room.floor]
    ?.[room.room];
  if (data) return data;
  return await downloadTimeslots(room, DATEQUERY);
}
