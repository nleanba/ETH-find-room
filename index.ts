import * as datetime from "https://deno.land/std@0.192.0/datetime/mod.ts";
import { Availability, Belegungstyp, RoomInfo, Timeslot } from "./types.ts";
import { getTimeslots, rooms } from "./data.ts";
import { Terminal, output } from "./terminal.ts";
import { readKeypress } from "https://deno.land/x/keypress@0.0.11/mod.ts";

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
  prompt(
    "Filter area? (regex) (Z: Zentrum, H: Hönggerberg, U: UZH)",
    FILTER_BDG.source ? ".*" : "Z",
  ) ??
    (FILTER_BDG.source ? ".*" : "Z"),
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

const date = datetime.parse(DATE, "yyyy-MM-dd");
const weekday = date.getDay();
const monday = new Date(
  datetime.parse(DATE, "yyyy-MM-dd").setDate(date.getDate() + 1 - weekday),
);
const sunday = new Date(
  datetime.parse(DATE, "yyyy-MM-dd").setDate(date.getDate() + 9 - weekday),
);

const DATEQUERY = `&from=${datetime.format(monday, "yyyy-MM-dd")}&to=${
  datetime.format(sunday, "yyyy-MM-dd")
}`;

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
  const data: Timeslot[] = await getTimeslots(room, DATEQUERY);

  //data.sort((a, b) => b.date_from.getTime() - a.date_from.getTime());

  return isAvailable(
    data,
    time,
    room,
  );
}

const roomlist = (await rooms()).filter((r) => {
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
      seats: r.seats || r.workplaces?.toLocaleString(),
      type: r.type,
    },
    TIME,
  )
);

console.log("Checking", roomlist.length, "rooms\n");

const result = await Promise.allSettled(roomlist);

const terminal = new Terminal(
  DATEQUERY,
  SHOW_LATER,
  SHOW_FIXED_SEATING,
  SHOW_SEATS,
  SHOW_UNAVAILABLE,
  TIME,
);
terminal.renderResults(result);

for await (const keypress of readKeypress()) {
  if (keypress.key === "down") await terminal.moveDown();
  if (keypress.key === "up") await terminal.moveUp();
  if (keypress.key === "r") await terminal.paintFrame();
  if ((keypress.ctrlKey && keypress.key === "c") || keypress.key === "q") await terminal.quit();
}

/*
let failures = 0;
let no_allocations = 0;
let available = 0;
let prev_bdg = "";
const bdg = (r: Availability) =>
  r.room.building === prev_bdg ? "   " : (prev_bdg = r.room.building).padEnd(3);

result.forEach((a) => {
  if (a.status === "fulfilled") {
    const r = a.value;
    if (r.available) {
      if (r.no_allocations) {
        ++no_allocations;
      } else if (r.future) {
        if (SHOW_LATER) {
          console.log(
            `${bdg(r)} \u001b[2;9m${createRoomLink(r.room)}\u001b[0m ${
              createScheduleLink(
                r.room,
                `\u001b[2mAvailable \u001b[1m${
                  datetime.format(new Date(r.date_from), "HH:mm")
                }\u001b[0m\u001b[2m -- \u001b[1m${
                  datetime.format(new Date(r.date_to), "HH:mm")
                }\u001b[0m`,
              )
            }\u001b[2m ${
              SHOW_SEATS
                ? (r.room.seats ? r.room.seats + " Seats" : "").padStart(10)
                : ""
            }${
              r.room.variable_seating
                ? ""
                : colors.brightRed(" · Fixed Seating")
            }${
              r.room.type !== "Seminare / Kurse"
                ? " \u001b[33m· Type: " + r.room.type + "\u001b[39m"
                : ""
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
          `${bdg(r)} ${createRoomLink(r.room)} ${
            createScheduleLink(
              r.room,
              `Available ${
                datetime.format(new Date(r.date_from), "HH:mm")
              } -- \u001b[1m${
                datetime.format(new Date(r.date_to), "HH:mm")
              }\u001b[0m`,
            )
          }\u001b[0m ${
            SHOW_SEATS
              ? (r.room.seats ? r.room.seats + " Seats" : "").padStart(10)
              : ""
          }${r.room.variable_seating ? "" : colors.red(" · Fixed Seating")}${
            r.room.type !== "Seminare / Kurse"
              ? " \u001b[33m· Type: " + r.room.type + "\u001b[39m"
              : ""
          }${
            r.current_allocation
              ? colors.magenta(" · Note: Reserved for " + r.current_allocation)
              : ""
          }`,
        );
        ++available;
      }
    } else if (SHOW_UNAVAILABLE) {
      console.log(
        `${bdg(r)} \u001b[2;9m${createRoomLink(r.room)} Unavailable\u001b[0m`,
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
*/
