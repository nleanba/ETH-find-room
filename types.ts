export enum Belegungstyp {
  event = 2,
  renovations = 5,
  closed = 7,
  lehrveranstaltung = 13,
  arbeitsplatz = 15,
}

interface TimeslotBase {
  veranstaltungsort: string;
  belegungsserie: {
    belegungsserie: string;
    veranstaltungsort: string;
    belegungstyp: Belegungstyp;
    veranstaltung?: {
      veranstaltung: string;
      allocationTitle: string;
      veranstaltungsnummer: string;
      veranstalter: string;
      veranstaltungstyp: string;
      findetStatt: number;
    };
  };
}

export interface TimeslotJSON extends TimeslotBase {
  date_from: string;
  date_to: string;
}

export interface Timeslot extends TimeslotBase {
  date_from: number; // using unix timestamps
  date_to: number; // using unix timestamps
}

export interface RoomInfo {
  building: string;
  floor: string;
  room: string;
  variable_seating: boolean;
  seats?: string;
  type: string;
}

interface Availability_no {
  available: false;
  room: RoomInfo;
}

interface Availability_yes {
  date_from: number; // using unix timestamps
  date_to: number; // using unix timestamps
  available: true;
  room: RoomInfo;
  no_allocations: boolean;
  current_allocation?: string;
  future: boolean;
}

export type Availability = Availability_yes | Availability_no;
