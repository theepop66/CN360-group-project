# VisionQC Control Unit — KiCad Schematic Build Guide

This guide walks you through drawing the ESP32 control unit schematic in **KiCad 10.0**.
The schematic matches the firmware pin mapping defined in `360ControlUnit/src/main.cpp`.

---

## 1. Project Setup

1. Open KiCad 10.0.
2. Click **File > Open Project** and navigate to `controlunit_schematic/controlunit_schematic.kicad_pro`.
3. Double-click `controlunit_schematic.kicad_sch` to open the schematic editor.
4. If the sheet is blank (it will be), press **E** or go to **File > Page Settings** to verify the paper size is **A4**.
5. Click the title block area (bottom-right corner of the page) and fill in:
   - **Title:** `VisionQC — Control Unit Schematic`
   - **Date:** today's date
   - **Rev:** `1.0`
   - **Company:** your group name

---

## 2. Pin Assignment Reference

These are the exact mappings from the firmware. Every wire you draw must connect to these GPIOs:

| Signal        | ESP32 GPIO | Direction       | Notes                                      |
|---------------|------------|-----------------|--------------------------------------------|
| IR Sensor Out | GPIO 4     | Input           | NPN open-collector, `INPUT_PULLUP`, active LOW |
| Servo Signal  | GPIO 18    | Output (PWM)    | ESP32Servo library, 50 Hz                  |
| Buzzer        | GPIO 21    | Output          | Active-high, drives via NPN or MOSFET      |
| LED Red       | GPIO 22    | Output          | Active-high through 220 Ω resistor         |
| LED Green     | GPIO 23    | Output          | Active-high through 220 Ω resistor         |

Power rails:
- **5 V** — servo VCC, buzzer supply
- **3.3 V** — ESP32 VDD, IR sensor VCC (see note below)
- **GND** — common ground

> **IR Sensor Power — 5 V vs 3.3 V:**
> The guide originally shows 5 V for the IR sensor because most common hobby sensors
> (E18-D80NK etc.) are rated for 5 V and have better detection range at that voltage.
> **However**, if your sensor supports 3.3 V operation, you can power it from the ESP32's
> 3.3V pin instead. The open-collector output is compatible with 3.3V logic either way
> because GPIO 4 uses `INPUT_PULLUP` which references the internal 3.3V rail.
> If you use 3.3V, move `IR_VCC` to the +3.3V net on the schematic.

---

## 3. Components You Will Place

| Ref   | Component                  | KiCad Library Symbol            | Qty | Notes                                    |
|-------|----------------------------|---------------------------------|-----|------------------------------------------|
| U1    | ESP32 DevKit V1            | `MCU_ESpressif:ESP32-DevKitC`  | 1   | 38-pin variant, WROOM-32 module          |
| J1    | IR Sensor Header           | `Connector_Generic:Conn_01x03` | 1   | 3-pin: VCC, OUT, GND                    |
| J2    | Servo Header               | `Connector_Generic:Conn_01x03` | 1   | 3-pin: Signal, VCC (5 V), GND           |
| J3    | Power Input Terminal       | `Connector_Generic:Conn_01x02` | 1   | 2-pin screw terminal, 5 V DC in         |
| D1    | Red LED                    | `LED_SMD:LED_0805`             | 1   | GPIO 22                                  |
| D2    | Green LED                  | `LED_SMD:LED_0805`             | 1   | GPIO 23                                  |
| R1    | LED Series Resistor        | `Resistor_SMD:R_0805`         | 1   | 220 Ω for D1                             |
| R2    | LED Series Resistor        | `Resistor_SMD:R_0805`         | 1   | 220 Ω for D2                             |
| Q1    | NPN Transistor (optional)  | `Device:Q_NPN_BCE`            | 1   | BC547 or 2N2222 — for buzzer drive       |
| R3    | Base Resistor (optional)   | `Resistor_SMD:R_0805`         | 1   | 1 kΩ base resistor for Q1                |
| C1    | Decoupling Capacitor       | `Capacitor_SMD:C_0805`        | 1   | 100 nF ceramic, close to ESP32 VDD       |
| C2    | Bulk Capacitor             | `Capacitor_SMD:C_1206`        | 1   | 10 µF electrolytic/ceramic on 5 V rail   |

> **Tip:** If you are using a pre-built ESP32 DevKit V1 board (with onboard 3.3 V regulator
> and USB), you do **not** need to add a separate voltage regulator to the schematic.
> The DevKit already regulates 5 V → 3.3 V internally.

---

## 4. Step-by-Step Placement and Wiring

### Step 4.1 — Place the ESP32

1. Press **A** (Add Symbol) or click the **Add Symbol** button on the right toolbar.
2. In the filter box, type `ESP32-DevKitC`.
3. Select the symbol from `MCU_ESpressif` and click **OK**.
4. Place the symbol near the **center-left** of the sheet.
5. Note the pin numbers on the symbol — you will connect wires to GPIO 4, 18, 21, 22, 23, plus 3V3, 5V, GND, and EN (leave EN unconnected or add a 10 kΩ pull-up to 3V3 if you want a reset button later).

### Step 4.2 — Place Power Symbols

1. Press **A**, type `power:+5V` and place near the top of the sheet.
2. Add another `power:+5V` symbol near J3 (power input) and J2 (servo VCC).
3. Press **A**, type `power:+3V3` and place near the ESP32 3V3 pin.
4. Press **A**, type `power:GND` and place near every component that needs ground.
5. **Important:** Add a `power:PWR_FLAG` symbol connected to both the +5V net and the GND net. This tells the ERC that these nets are driven by a power source.

### Step 4.3 — Place IR Sensor Connector (J1)

1. Press **A**, search `Conn_01x03`, place to the **right** of the ESP32.
2. Label the pins using net labels (press **L** or use the net label tool):
   - Pin 1 → `+3V3` power symbol (sensor VCC — use +5V here only if your sensor is 5V-only)
   - Pin 2 → net label `IR_OUT` (this connects to ESP32 GPIO 4)
   - Pin 3 → `GND` (power symbol)
3. Place a net label `IR_OUT` on the ESP32 side near GPIO 4.
4. Connect both `IR_OUT` labels with a wire (**W** key), or KiCad will merge them automatically since they share the same net name.

### Step 4.4 — Place Servo Connector (J2)

1. Press **A**, search `Conn_01x03`, place to the **right** of the ESP32, below J1.
2. Label the pins:
   - Pin 1 → net label `SVO_SIG` (connects to GPIO 18)
   - Pin 2 → `+5V` (servo power)
   - Pin 3 → `GND`
3. Place a matching `SVO_SIG` net label near GPIO 18 on the ESP32.

### Step 4.5 — Place Buzzer Circuit

1. Place a 2-pin connector `Conn_01x02` for the buzzer (J4), or place the buzzer symbol directly (`Device:Buzzer`).
2. **Recommended drive circuit** (for active buzzer):
   - Connect one buzzer pin to +5V.
   - Connect the other buzzer pin to the **collector** of NPN transistor Q1 (BC547).
   - Connect Q1 **emitter** to GND.
   - Connect Q1 **base** through R3 (1 kΩ) to a net label `BUZ Drive`.
   - Place a matching `BUZ Drive` net label near GPIO 21 on the ESP32.
3. **If using a small active buzzer (< 20 mA):** You can skip the transistor and connect GPIO 21 → R (330 Ω) → buzzer → GND directly. The ESP32 GPIO can source ~20 mA, which is enough for a small buzzer.

### Step 4.6 — Place LED Indicators

**Red LED (D1 — GPIO 22):**

1. Place LED symbol `D1` (LED_0805) to the **bottom** of the ESP32.
2. Place series resistor `R1` (220 Ω) in series with the LED anode.
3. Connect: GPIO 22 → R1 → D1 anode → D1 cathode → GND.
4. Use a net label `LED_RED` between the GPIO pin and R1 for clarity.

**Green LED (D2 — GPIO 23):**

1. Place LED symbol `D2` (LED_0805) next to D1.
2. Place series resistor `R2` (220 Ω) in series with the LED anode.
3. Connect: GPIO 23 → R2 → D2 anode → D2 cathode → GND.
4. Use a net label `LED_GRN` between the GPIO pin and R2 for clarity.

### Step 4.7 — Place Decoupling Capacitors

1. Place `C1` (100 nF) with one pin on the `+3V3` net and the other on `GND`.
2. Position it physically close to the ESP32 3V3 and GND pins on the schematic (this is a layout hint for later PCB work).
3. Place `C2` (10 µF) with one pin on `+5V` and the other on `GND`.
4. Position it near the power input connector J3.

### Step 4.8 — Power Input (J3)

1. Place a 2-pin screw terminal `J3` on the **left side** of the sheet.
2. Pin 1 → `+5V` power symbol.
3. Pin 2 → `GND` power symbol.
4. This is where you connect an external 5 V DC adapter or USB power supply.

### Step 4.9 — Wire Everything

1. Press **W** to enter wiring mode.
2. Click the pin of a symbol, then click the destination pin or net label endpoint to draw a wire.
3. Use net labels (**L** key) to connect distant points instead of running long wires across the sheet.
4. For power symbols (+5V, +3V3, GND), just place them on the pin — no wire needed if they sit directly on the pin.
5. Double-check that every GPIO pin listed in Section 2 has a corresponding net label.

---

## 5. Net Label Summary

After completing the wiring, your schematic should have these named nets:

| Net Name   | Connects ESP32 Pin | Connects To            |
|------------|---------------------|------------------------|
| `IR_OUT`   | GPIO 4              | J1 pin 2 (IR sensor)  |
| `SVO_SIG`  | GPIO 18             | J2 pin 1 (servo)       |
| `BUZ Drive`| GPIO 21             | Q1 base (via R3)       |
| `LED_RED`  | GPIO 22             | R1 → D1 → GND         |
| `LED_GRN`  | GPIO 23             | R2 → D2 → GND         |

All other connections use global power symbols (`+5V`, `+3V3`, `GND`).

---

## 6. Power Design

```
                   ┌──────────────┐
  5V DC IN ───────►│  J3 (2-pin)  │
                   └──────┬───────┘
                          │
                   ┌──────┴───────┐
                   │   +5V Rail   │──────────────────┐
                   │  (C2: 10µF)  │                  │
                   └──────┬───────┘                  │
                          │                          ├─► J2 pin 2 (Servo VCC)
                   (onboard regulator               └─► Buzzer VCC
                    on ESP32 DevKit)
                          │
                   ┌──────┴───────┐
                   │  +3.3V Rail  │──────────────────┐
                   │  (C1: 100nF) │                  │
                   └──────────────┘                  ├─► ESP32 VDD pins
                                                     └─► J1 pin 1 (IR VCC)*
                                                     (* 3.3V sensor supply.
                                                        Use +5V only for 5V-only
                                                        sensors.)
```

> **Note:** If you are using the ESP32 DevKit V1 as-is, the onboard AMS1117-3.3 handles
> the 5 V → 3.3 V conversion. You do **not** need to add a regulator symbol on the schematic.
> The 3.3V rail is already present on the DevKit board's 3V3 pin.

---

## 7. Running the ERC (Electrical Rules Check)

1. Click **Tools > Inspect Errors** or press **Shift+E**.
2. Click **Run ERC**.
3. Review all errors and warnings. Common issues and fixes:

| ERC Message                          | Cause / Fix                                              |
|--------------------------------------|----------------------------------------------------------|
| `Pin not driven`                     | Add `PWR_FLAG` on +5V and GND nets                      |
| `Unconnected pin`                    | Connect or add `No Connect` marker (`Q` key) to unused pins |
| `Conflict: power pin driven`        | Check for two different voltage sources on the same net   |
| `Pin type mismatch (input/output)`  | Verify wire connections, check symbol pin types           |

4. Fix all **errors** (warnings can sometimes be intentional). Re-run ERC until clean.

> **Tip:** For unused ESP32 GPIO pins, place a `No Connect` flag (press **Q**) on them
> to suppress unconnected-pin warnings.

---

## 8. Bill of Materials (BOM)

| Ref | Component              | Value / Part Number     | Package   | Qty | Supplier (example)          | Notes                           |
|-----|------------------------|-------------------------|-----------|-----|-----------------------------|---------------------------------|
| U1  | ESP32 DevKit V1        | ESP32-WROOM-32 DevKit   | DevKit    | 1   | Amazon / AliExpress         | 38-pin, Type-C USB              |
| J1  | Header (IR Sensor)     | 2.54 mm male header     | 1x3       | 1   | Any electronics supplier    | Solder to IR sensor cable       |
| J2  | Header (Servo)         | 2.54 mm male header     | 1x3       | 1   | Any electronics supplier    | Solder to servo cable           |
| J3  | Screw Terminal         | 5.08 mm 2-pin           | PCB mount | 1   | AliExpress / DigiKey        | For 5 V DC input                |
| J4  | Buzzer Header (opt.)   | 2.54 mm male header     | 1x2       | 1   | Any electronics supplier    | If using plug-in buzzer         |
| D1  | LED (Red)              | 0805 SMD or 3mm through | 0805/THT  | 1   | AliExpress                  | Status: reject alert            |
| D2  | LED (Green)            | 0805 SMD or 3mm through | 0805/THT  | 1   | AliExpress                  | Status: pass signal             |
| R1  | Resistor               | 220 Ω                   | 0805/THT  | 1   | AliExpress / DigiKey        | D1 series current limiting      |
| R2  | Resistor               | 220 Ω                   | 0805/THT  | 1   | AliExpress / DigiKey        | D2 series current limiting      |
| R3  | Resistor (opt.)        | 1 kΩ                    | 0805/THT  | 1   | AliExpress / DigiKey        | Q1 base resistor (buzzer drive) |
| Q1  | NPN Transistor (opt.)  | BC547 / 2N2222          | TO-92     | 1   | AliExpress                  | Buzzer low-side switch          |
| C1  | Ceramic Capacitor      | 100 nF (0.1 µF)        | 0805      | 1   | AliExpress / DigiKey        | ESP32 VDD decoupling            |
| C2  | Ceramic/Elec Capacitor | 10 µF                   | 1206      | 1   | AliExpress / DigiKey        | 5 V rail bulk decoupling        |
| —   | IR Photoelectric Sensor| NPN open-collector, 3-wire | —      | 1   | AliExpress (E18-D80NK etc.) | Use 3.3V sensor if 3.3V-compatible; E18-D80NK is 5V-only |
| —   | Micro Servo            | SG90 or equivalent       | —         | 1   | AliExpress                  | 5 V, 0–90° range               |
| —   | Active Buzzer          | 5 V active buzzer        | —         | 1   | AliExpress                  | Sounder for reject alert        |
| —   | 5 V DC Power Supply    | 2A minimum               | —         | 1   | Any                         | USB adapter or bench supply     |

---

## 9. Final Checklist Before Exporting

- [ ] All components placed and annotated (use **Tools > Annotate Schematic**)
- [ ] All nets connected — no floating inputs on GPIOs
- [ ] `PWR_FLAG` symbols on +5V and GND
- [ ] `No Connect` flags on unused ESP32 pins
- [ ] ERC passes with zero errors
- [ ] Title block filled in
- [ ] Decoupling capacitors placed on correct power nets

---

## 10. Exporting the Schematic

1. **PDF:** File > Export > PDF — selects the current sheet. Save to project docs folder.
2. **SVG/PNG:** File > Export > SVG or use KiCad's Plot utility for documentation images.
3. **Netlist:** Tools > Generate Netlist — needed if you proceed to PCB layout later.
4. **BOM:** Tools > Edit Symbol Fields or use a BOM plugin (e.g., InteractiveHtmlBom) for a formatted parts list.

---

## Appendix A — Complete GPIO Wiring Table (Quick Reference)

```
ESP32 DevKit V1 Pinout (relevant pins only):

  EN  ──── [10k to 3V3] (optional, for reset button)
  IO4 ──────── IR Sensor OUT (J1.2) — VCC: 3.3V (or 5V if sensor is 5V-only)
  IO18 ─────── Servo Signal  (J2.1) — VCC on +5V rail
  IO21 ─────── Buzzer Drive  (Q1 base via 1k or direct via 330R)
  IO22 ─── R1 ─── D1(Red LED)  ─── GND
  IO23 ─── R2 ─── D2(Green LED) ─── GND
  3V3 ──────── C1 (100nF) to GND
  GND ──────── Common ground rail
  VIN ──────── 5V DC from J3 (also powers +5V rail)
```

---

*Guide written for KiCad 10.0 — VisionQC project, CN360 Group, September 2026*
