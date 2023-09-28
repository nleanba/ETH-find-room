import * as datetime from "https://deno.land/std@0.192.0/datetime/mod.ts";
import { writeAll } from "https://deno.land/std@0.192.0/streams/write_all.ts";
import { Availability, RoomInfo } from "./types.ts";

const text = new TextEncoder();
const output = async (t: string) => await writeAll(Deno.stdout, text.encode(t));

// deno-lint-ignore no-control-regex
const prinable_length = (text: string) =>
  text.replace(
    /\u001b\[[0-9:;<=>?]*[!"#$%&'()*+,-./ ]*[@A-Z[\\\]^_`a-z{|}~]/g,
    "",
  ).replace(/\u001b\]([^\u001b]|\u001b[^\\])*\u001b\\/g, "").length;

const fix_length = (text = "", length: number, fill = " ") => {
  const pl = prinable_length(text);
  if (pl <= length) return text + fill.repeat(length - pl);
  return text;
};

const escape = (code: string) => `\u001b[${code}`;

const codes = {
  cursor_up: (n = 1) => escape(`${n}A`), // moves cursor n cells up
  cursor_dn: (n = 1) => escape(`${n}B`), // moves cursor n cells down
  cursor_fwd: (n = 1) => escape(`${n}C`), // moves cursor n cells forward
  cursor_bwd: (n = 1) => escape(`${n}D`), // moves cursor n cells backward
  cursor_l_dn: (n = 1) => escape(`${n}E`), // moves cursor n lines down and to the beginning of the line
  cursor_l_up: (n = 1) => escape(`${n}F`), // moves cursor n lines up and to the beginning of the line
  cursor_abs: (n = 1, m = 1) => escape(`${n};${m}H`), // moves cursor to position row=n col=m
  erase: (n = 3) => escape(`${n}J`), // erases screen. 0: cursor to end, 1: cursor to start, 2: entire screen, 3 default: entire screen and clear scrollback
  style: (n = 0) => escape(`${n}m`),
  hide_cursor: () => escape(`?;25;l`),
  show_cursor: () => escape(`?;25;h`),
};

function linkify(text: string, url: string) {
  return `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`;
}

export class Terminal {
  cols: number;
  rows: number;
  SHOW_LATER: boolean;
  SHOW_FIXED_SEATING: boolean;
  SHOW_SEATS: boolean;
  SHOW_UNAVAILABLE: boolean;
  DATEQUERY: string;
  buffer: string[] = [];
  window_start = 0;
  selected = 0;

  title = "";

  constructor(
    DATEQUERY: string,
    SHOW_LATER: boolean,
    SHOW_FIXED_SEATING: boolean,
    SHOW_SEATS: boolean,
    SHOW_UNAVAILABLE: boolean,
  ) {
    const { columns, rows } = Deno.consoleSize();
    this.rows = rows;
    this.cols = columns;
    this.SHOW_LATER = SHOW_LATER;
    this.SHOW_FIXED_SEATING = SHOW_FIXED_SEATING;
    this.SHOW_SEATS = SHOW_SEATS;
    this.SHOW_UNAVAILABLE = SHOW_UNAVAILABLE;
    this.DATEQUERY = DATEQUERY;
  }

  createRoomLink(room: RoomInfo) {
    return linkify(
      `${room.floor.padEnd(2)} ${room.room.padEnd(5)}`,
      `https://ethz.ch/staffnet/de/utils/location.html?building=${room.building}&floor=${room.floor}&room=${room.room}`,
    );
  }

  createScheduleLink(room: RoomInfo, text: string) {
    return linkify(
      text,
      `https://ethz.ch/staffnet/de/service/raeume-gebaeude/rauminfo/raumdetails/allocation.html?room=${room.building}+${room.floor}+${room.room}${this.DATEQUERY}`,
    );
  }

  async paintFrame(
    title = this.title,
  ) {
    const { columns, rows } = Deno.consoleSize();
    this.rows = rows;
    this.cols = columns;
    this.title = title;

    const scrollbar_begin = Math.floor(
      (rows - 2) * this.window_start / this.buffer.length,
    );
    const scrollbar_end = ((rows - 2) * (rows - 2) / this.buffer.length) +
      scrollbar_begin;
    const show_scollbar = rows - 2 < this.buffer.length;

    await output(codes.hide_cursor());
    await output(codes.cursor_abs(1, 1));
    await output(codes.erase(3));
    await output(
      ("┌─ " + title + " ").padEnd(this.cols - 1, "─") +
        "┐",
    );
    for (let i = 0; i < this.rows; ++i) {
      await output(codes.cursor_abs(i + 2, 1));
      await output(
        (i + this.window_start === this.selected ? "‣" : "│") +
          fix_length(this.buffer[this.window_start + i], this.cols - 2) +
          (show_scollbar
            ? ((i >= scrollbar_begin && i <= scrollbar_end) ? "█" : "░")
            : "│"),
      );
    }
    await output(codes.cursor_abs(this.rows, 1));
    await output("└" + "".padEnd(this.cols - 2, "─") + "┘");
  }

  async renderResults(result: PromiseSettledResult<Availability>[]) {
    let failures = 0;
    let no_allocations = 0;
    let available = 0;
    let prev_bdg = "";
    const bdg = (r: Availability) =>
      r.room.building === prev_bdg
        ? "    "
        : " " + (prev_bdg = r.room.building).padEnd(3);
    this.buffer = [];
    result.forEach((a) => {
      if (a.status === "fulfilled") {
        const r = a.value;
        if (r.available) {
          if (r.no_allocations) {
            ++no_allocations;
          } else if (r.future) {
            if (this.SHOW_LATER) {
              this.buffer.push(
                `${bdg(r)} \u001b[2;9m${this.createRoomLink(r.room)}\u001b[0m ${
                  this.createScheduleLink(
                    r.room,
                    `\u001b[2mAvailable \u001b[1m${
                      datetime.format(new Date(r.date_from), "HH:mm")
                    }\u001b[0m\u001b[2m -- \u001b[1m${
                      datetime.format(new Date(r.date_to), "HH:mm")
                    }\u001b[0m`,
                  )
                }\u001b[2m ${
                  this.SHOW_SEATS
                    ? (r.room.seats ? r.room.seats + " Seats" : "").padStart(10)
                    : ""
                }${
                  r.room.variable_seating
                    ? ""
                    : (" " + codes.style(91) + "· Fixed Seating" +
                      codes.style())
                }${
                  r.room.type !== "Seminare / Kurse"
                    ? " \u001b[33m· Type: " + r.room.type + "\u001b[39m"
                    : ""
                }${
                  r.current_allocation
                    ? (" " + codes.style(35) +
                      "· Reserved: " + r.current_allocation +
                      codes.style())
                    : ""
                }\u001b[0m`,
              );
            }
          } else {
            this.buffer.push(
              `${bdg(r)} ${this.createRoomLink(r.room)} ${
                this.createScheduleLink(
                  r.room,
                  `Available ${
                    datetime.format(new Date(r.date_from), "HH:mm")
                  } -- \u001b[1m${
                    datetime.format(new Date(r.date_to), "HH:mm")
                  }\u001b[0m`,
                )
              }\u001b[0m ${
                this.SHOW_SEATS
                  ? (r.room.seats ? r.room.seats + " Seats" : "").padStart(10)
                  : ""
              }${
                r.room.variable_seating
                  ? ""
                  : (" " + codes.style(91) + "· Fixed Seating" + codes.style())
              }${
                r.room.type !== "Seminare / Kurse"
                  ? " \u001b[33m· Type: " + r.room.type + "\u001b[39m"
                  : ""
              }${
                r.current_allocation
                  ? (" " + codes.style(35) +
                    "· Note: Reserved for " + r.current_allocation +
                    codes.style())
                  : ""
              }`,
            );
            ++available;
          }
        } else if (this.SHOW_UNAVAILABLE) {
          this.buffer.push(
            `${bdg(r)} \u001b[2;9m${
              this.createRoomLink(r.room)
            } Unavailable\u001b[0m`,
          );
        }
      } else {
        ++failures;
      }
    });
    await this.paintFrame(
      `${available} Available Rooms` +
        (no_allocations
          ? ` ─ Could not read ${no_allocations} schedules`
          : "") +
        (failures ? ` ─ Had ${failures} failed requests` : ""),
    );
  }

  async scrollUp() {
    if (this.window_start === 0) await this.paintFrame();
    this.window_start -= 1;
    await this.paintFrame();
  }

  async scrollDown() {
    if (this.window_start + this.rows - 2 >= this.buffer.length) {
      await this.paintFrame();
    }
    this.window_start += 1;
    await this.paintFrame();
  }

  async moveUp() {
    if (this.selected === 0) return;
    this.selected -= 1;
    if (this.selected <= this.window_start && this.selected > 0) {
      await this.scrollUp();
    } else {
      if (this.selected - this.window_start + 3 < this.rows) {
        await output(
          codes.cursor_abs(this.selected - this.window_start + 3, 1),
        );
        await output("│");
      }
      await output(codes.cursor_abs(this.selected - this.window_start + 2, 1));
      await output("‣");
    }
  }

  async moveDown() {
    if (this.selected === this.buffer.length - 1) return;
    this.selected += 1;
    if (
      this.selected >= this.window_start + this.rows - 3 &&
      this.selected < this.buffer.length - 1
    ) {
      await this.scrollDown();
    } else {
      if (this.selected - this.window_start + 1 > 1) {
        await output(
          codes.cursor_abs(this.selected - this.window_start + 1, 1),
        );
        await output("│");
      }
      await output(codes.cursor_abs(this.selected - this.window_start + 2, 1));
      await output("‣");
    }
  }
}
