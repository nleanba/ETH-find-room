# Find Available Rooms at ETH

this is a quick & dirty hobby project

requires deno (https://deno.com/runtime)

run with `deno run --allow-net ./index.ts`

## Why

- I like to study at ETH _on-site_ (I can concentrate much better than at home).
- I like to study in an unoccupied seminar/meeting room (often more quiet than
  the provided workspaces for students)
- Finding a Room using either of the online tools provided by ETH
  (https://ethz.ch/staffnet/de/service/raeume-gebaeude/rauminfo.html or
  https://www.rauminfo.ethz.ch/IndexPre.do) is cumbersome, as there’s no way of
  filtering for rooms that are currently available, instead one needs to
  manually open the details page of the room, then from there the Room
  Allocations

## Notes

- List of rooms (stored in rooms.ts) was obtained from
  `https://ethz.ch/bin/ethz/roominfo?path=/rooms&lang=de`
- For each room it checks, it sends a request to
  `https://ethz.ch/bin/ethz/roominfo?path=/rooms/${room.building}%20${room.floor}%20${room.room}/allocations&from=${DATE}&to=${DATE}`
- I have no idea if that API is supposed to be publicly accessible, but I sure
  hope it stays up

All results of this tool are to be treated as guesswork, I take no
responsibility for correctness.
