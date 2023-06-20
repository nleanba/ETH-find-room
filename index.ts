import * as datetime from "https://deno.land/std@0.192.0/datetime/mod.ts";
import * as colors from "https://deno.land/std@0.192.0/fmt/colors.ts";
import { rooms } from "./rooms.ts";
import {
  Availability,
  Belegungstyp,
  RoomInfo,
  Timeslot,
  TimeslotJSON,
} from "./types.ts";

const DATE: string = prompt(
  "Which day to check? (yyyy-MM-dd)",
  datetime.format(new Date(), "yyyy-MM-dd"),
) ?? datetime.format(new Date(), "yyyy-MM-dd");
const TIME = datetime.parse(
  DATE + " " +
    (prompt(
      "Which time to check? (HH:mm)",
      datetime.format(new Date(), "HH:mm"),
    ) ?? datetime.format(new Date(), "HH:mm")),
  "yyyy-MM-dd HH:mm",
);
const FILTER_BDG = RegExp(
  prompt("Filter building? (regex) [.*]", "") ??
    "",
  "i",
);
const FILTER_AREA = RegExp(
  prompt("Filter area? (regex) (Z: Zentrum, H: Hönggerberg, U: UZH) [Z]") ??
    (FILTER_BDG.source ? "" : "Z"),
  "i",
);
const other_options = (prompt(
  "Other config? (f: show rooms with fixed seating, u: show fully unavailable rooms, l: show rooms available later in the day, t: only check first 10 rooms, s: show number of seats) [ls]",
) ?? "ls").toLocaleLowerCase();
const SHOW_FIXED_SEATING = other_options.includes("f");
const SHOW_UNAVAILABLE = other_options.includes("u");
const SHOW_LATER = other_options.includes("l");
const SHOW_SEATS = other_options.includes("s");
const TRIAL = other_options.includes("t");

function isAvailable(
  data: Timeslot[],
  time: Date,
  room: RoomInfo,
): Availability {
  const time_ms = time.getTime();
  const conflicts = data.filter((t) => {
    return t.belegungsserie.belegungstyp !== Belegungstyp.arbeitsplatz &&
      t.date_from <= time_ms && t.date_to > time_ms;
  });
  if (conflicts.length) {
    let date_from = conflicts[0].date_to;
    let date_to = datetime.parse(DATE + " 23:59", "yyyy-MM-dd HH:mm")
      .getTime();

    data.forEach((t) => {
      if (t.date_from >= date_from && t.date_from < date_to) {
        date_to = t.date_from;
      }
      if (t.date_from < date_from && t.date_to > date_from) {
        date_from = t.date_to;
      }
    });
    if (date_to - date_from > 1000 * 60 * 15) {
      // only return slot > 15'
      return {
        date_from,
        date_to,
        room,
        available: true,
        no_allocations: false,
        future: true,
      };
    }

    return {
      room,
      available: false,
    };
  }

  const pseudo_conflicts = data.filter((t) => {
    return !!(t.belegungsserie.veranstaltung) &&
      t.belegungsserie.belegungstyp === Belegungstyp.arbeitsplatz &&
      t.date_from <= time_ms && t.date_to > time_ms;
  }).map((t) =>
    `“${t.belegungsserie.veranstaltung!.allocationTitle}” ${
      datetime.format(new Date(t.date_from), "HH:mm")
    }-${datetime.format(new Date(t.date_to), "HH:mm")}`
  ).join(", ");

  let date_from = datetime.parse(DATE, "yyyy-MM-dd").getTime();
  let date_to = datetime.parse(DATE + " 23:59", "yyyy-MM-dd HH:mm")
    .getTime();

  data.forEach((t) => {
    if (t.date_from >= time_ms && t.date_from < date_to) {
      date_to = t.date_from;
    }
    if (t.date_to <= time_ms && t.date_to > date_from) {
      date_from = t.date_to;
    }
  });
  return {
    date_from,
    date_to,
    room,
    available: true,
    no_allocations: (data.length === 0),
    current_allocation: pseudo_conflicts,
    future: false,
  };
}

async function checkAvailiable(
  room: RoomInfo,
  time: Date,
): Promise<Availability> {
  const date = datetime.parse(DATE, "yyyy-MM-dd");
  const weekday = date.getDay();
  const monday = new Date(datetime.parse(DATE, "yyyy-MM-dd").setDate(date.getDate() + 1 - weekday));
  const sunday = new Date(datetime.parse(DATE, "yyyy-MM-dd").setDate(date.getDate() + 9 - weekday));

  // sometimes week-long events get missed if only a single day is queried
  const url = `https://ethz.ch/bin/ethz/roominfo?path=/rooms/${
    encodeURIComponent(`${room.building} ${room.floor} ${room.room}`)
  }/allocations&from=${datetime.format(monday, "yyyy-MM-dd")}&to=${datetime.format(sunday, "yyyy-MM-dd")}`;

  // console.log(url);

  const json: TimeslotJSON[] = await fetch(url).then((r) => r.json());
  const data: Timeslot[] = json.map((t) => {
    return {
      ...t,
      date_from: datetime.parse(t.date_from, "yyyy-MM-ddTHH:mm:ss").getTime(),
      date_to: datetime.parse(t.date_to, "yyyy-MM-ddTHH:mm:ss").getTime(),
    };
  });

  //data.sort((a, b) => b.date_from.getTime() - a.date_from.getTime());

  return isAvailable(
    data,
    time,
    room,
  );
}

const roomlist = rooms.filter((r) => {
  if (!FILTER_AREA.test(r.area)) return false;
  if (!FILTER_BDG.test(r.building)) return false;
  if (!SHOW_FIXED_SEATING && (!r.seating || r.seating !== "variabel")) {
    return false;
  }
  return true;
}).slice(0, TRIAL ? 10 : undefined).map((r) =>
  checkAvailiable(
    {
      building: r.building,
      floor: r.floor,
      room: r.room,
      variable_seating: r.seating === "variabel",
      seats: r.seats,
    },
    TIME,
  )
);

console.log("Checking", roomlist.length, "rooms\n");

const result = await Promise.allSettled(roomlist);

let failures = 0;
let no_allocations = 0;
let available = 0;
let prev_bdg = "";
result.forEach((a) => {
  if (a.status === "fulfilled") {
    const r = a.value;
    const bdg = r.room.building === prev_bdg
      ? "   "
      : (prev_bdg = r.room.building).padEnd(3);
    if (r.available) {
      if (r.no_allocations) {
        ++no_allocations;
      } else if (r.future) {
        if (SHOW_LATER) {
          console.log(
            `${bdg} \u001b[2;9m${r.room.floor.padEnd(2)} ${
              r.room.room.padEnd(5)
            }\u001b[0m\u001b[2m Available \u001b[1m${
              datetime.format(new Date(r.date_from), "HH:mm")
            }\u001b[0m\u001b[2m -- \u001b[1m${
              datetime.format(new Date(r.date_to), "HH:mm")
            }\u001b[0m\u001b[2m ${
              SHOW_SEATS
                ? (r.room.seats ? r.room.seats + " Seats" : "").padStart(10)
                : ""
            }${
              r.room.variable_seating
                ? ""
                : colors.brightRed(" · Fixed Seating")
            }${
              r.current_allocation
                ? colors.magenta(
                  " · Note: Reserved for " + r.current_allocation,
                )
                : ""
            }\u001b[0m`,
          );
        }
      } else {
        console.log(
          `${bdg} ${r.room.floor.padEnd(2)} ${
            r.room.room.padEnd(5)
          } Available ${
            datetime.format(new Date(r.date_from), "HH:mm")
          } -- \u001b[1m${
            datetime.format(new Date(r.date_to), "HH:mm")
          }\u001b[0m ${
            SHOW_SEATS
              ? (r.room.seats ? r.room.seats + " Seats" : "").padStart(10)
              : ""
          }${r.room.variable_seating ? "" : colors.red(" · Fixed Seating")}${
            r.current_allocation
              ? colors.magenta(" · Note: Reserved for " + r.current_allocation)
              : ""
          }`,
        );
        ++available;
      }
    } else if (SHOW_UNAVAILABLE) {
      console.log(
        `${bdg} \u001b[2;9m${r.room.floor.padEnd(2)} ${
          r.room.room.padEnd(5)
        } Unavailable\u001b[0m`,
      );
    }
  } else {
    ++failures;
  }
});

console.log("\nFound", available, "available rooms");
console.log(
  "Could not read schedule for",
  no_allocations,
  "rooms (this probably means that those schedules are not public)",
);
if (failures > 0) console.log("Had", failures, "failed requests");
