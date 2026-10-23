# OpenRung bridge

Serves the OpenRung virtual controller's tags over **Modbus TCP** and **OPC UA**, so other tools (FUXA, Ignition, Node-RED, a Python script) can read and write them. The controller still runs in the browser; the page sends tag values here every 200 ms and receives writes back.

A web page cannot open Modbus or OPC UA ports itself, which is why this small helper exists.

## Run it

```
cd bridge
npm install          # ws, modbus-serial, and node-opcua (optional, large)
npm start            # ws://127.0.0.1:8502, Modbus TCP on 5020, OPC UA on 4840
```

Options: `--port 8502 --modbus 5020 --opcua 4840 --map openrung-map.json` (or `OPENRUNG_PORT`, `OPENRUNG_MODBUS`, ...). Port 502 needs admin rights, so the default is 5020.

Then open OpenRung **from its local `index.html` or from GitHub Pages** (the Claude artifact viewer blocks local connections), go online, click the controller status in the top bar, and press **Connect** under *Bridge to other tools*.

Open http://127.0.0.1:8502/ to see the address of every tag.

## Address map

- BOOL tags are **coils** (also readable as discrete inputs), numbered from 0.
- Every other tag takes **two holding registers** (also readable as input registers), high word first: DINT, INT and SINT as signed 32-bit integers, REAL as a 32-bit float (big-endian, "ABCD").
- Arrays and structures are flattened: `Station[1].Step`, `Run_Timer.ACC`, `Program:MainProgram.Local_Tag`.
- New tags get the next free address. The map is saved in `openrung-map.json`, so addresses do not move between runs. Delete that file to renumber.

OPC UA: endpoint `opc.tcp://localhost:4840/OpenRung`, no security, every tag is a variable under `Objects/OpenRung` with node id `ns=1;s=<tag path>`, for example `ns=1;s=Tank_Level`.

Writes only reach the controller while the OpenRung page is online.

## Test with FUXA

1. Run FUXA (`docker run -d -p 1881:1881 frangoteam/fuxa:latest`) and open http://localhost:1881.
2. Connections: add a device, type **ModbusTCP**, address `host.docker.internal` (or your PC's IP) and port `5020`, slave id 1.
3. Add tags from the map page: `Start_PB` as Coil Status at its coil address, `Tank_Level` as Holding Register, type **Float32**, at its register address. Use Int32 for DINT tags.
4. Draw a button bound to `Start_PB` and a gauge bound to `Tank_Level`. With OpenRung online and in Run, the gauge follows the tank model and the button starts the line.

## Self-test

With the bridge running, `npm test` pretends to be the page and checks coil and register reads and writes over Modbus TCP.

License: MIT.
