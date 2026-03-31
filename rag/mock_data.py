# Realistic mock chunks per MECON category
# Each entry mirrors what a real RAG chunk would look like:
# {"source": "filename.pdf — Page N", "content": "..."}

MOCK_DATA = {
    "piping_valves": [
        {
            "source": "MECON_Piping_Spec_IS1239.pdf — Page 12",
            "content": (
                "6 inch NB CS Pipe, SCH 40 as per IS 1239 Part 1. "
                "Wall thickness: 7.11 mm. OD: 168.3 mm. Weight: 28.26 kg/m. "
                "Material: IS 1239 Grade 1 (ERW). Hydrostatic test pressure: 50 bar."
            )
        },
        {
            "source": "MECON_Valve_Datasheet_GateValves.pdf — Page 5",
            "content": (
                "Gate Valve, 4 inch, Class 150, Flanged End, CS Body (ASTM A216 WCB). "
                "Face to face as per ASME B16.10. Trim: SS 410. "
                "Test pressure (shell): 30 bar. Test pressure (seat): 22 bar."
            )
        },
        {
            "source": "MECON_Piping_Spec_IS1239.pdf — Page 8",
            "content": (
                "4 inch NB CS Pipe, SCH 40 as per IS 1239 Part 1. "
                "Wall thickness: 6.02 mm. OD: 114.3 mm. Weight: 16.07 kg/m."
            )
        },
    ],

    "structural_steel": [
        {
            "source": "MECON_Structural_Steel_Schedule.pdf — Page 3",
            "content": (
                "ISMB 300 — Indian Standard Medium Weight Beam. "
                "Weight: 44.2 kg/m. Flange width: 140 mm. Web thickness: 7.5 mm. "
                "Flange thickness: 12.4 mm. Grade: IS 2062 E250 (Fe 410W). "
                "Moment of Inertia Ixx: 8603 cm⁴."
            )
        },
        {
            "source": "MECON_BOQ_Template_SteelStructure.pdf — Page 2",
            "content": (
                "Structural steel fabrication rate: INR 72,000 per MT (ex-works). "
                "Erection rate: INR 8,500 per MT. Primer painting (1 coat): INR 4,200 per MT. "
                "All rates exclusive of GST @18%."
            )
        },
        {
            "source": "MECON_Structural_Steel_Schedule.pdf — Page 7",
            "content": (
                "ISMC 200 — Indian Standard Medium Weight Channel. "
                "Weight: 22.1 kg/m. Flange width: 75 mm. Web thickness: 6.1 mm. "
                "Grade: IS 2062 E250."
            )
        },
    ],

    "equipment": [
        {
            "source": "MECON_Equipment_Datasheet_Pumps.pdf — Page 14",
            "content": (
                "Centrifugal Pump — Cooling Water Service. Capacity: 500 m³/hr. "
                "Head: 40 m. Speed: 1480 RPM. Driver: 75 kW TEFC Motor, 415V/3Ph/50Hz. "
                "Casing: CI IS 210 Gr FG 260. Impeller: SS 316."
            )
        },
        {
            "source": "MECON_Equipment_Datasheet_Blowers.pdf — Page 6",
            "content": (
                "Roots Blower — BF Gas Service. Capacity: 1200 Nm³/hr. "
                "Pressure: 0.5 kg/cm². Motor: 30 kW. Casing: CI."
            )
        },
    ],

    "bf_process": [
        {
            "source": "MECON_BF_Process_Design_Basis.pdf — Page 22",
            "content": (
                "Blast Furnace — 350 m³ Working Volume. "
                "Hot Metal Production: 750 TPD. Coke Rate: 520 kg/THM. "
                "Hot Metal Composition: C: 4.0–4.5%, Si: 0.3–0.8%, Mn: 0.2–0.5%, "
                "P: max 0.12%, S: max 0.05%. Blast Temperature: 1050°C."
            )
        },
        {
            "source": "MECON_BF_Stove_Spec.pdf — Page 3",
            "content": (
                "Hot Blast Stove — Internal Combustion Type. "
                "Dome temperature: 1300°C max. Shell diameter: 7.5 m. "
                "Checker volume: 2200 m³. Blast volume: 1050 Nm³/min."
            )
        },
    ],

    "price_schedules": [
        {
            "source": "MECON_Price_Schedule_2024_Q3.pdf — Page 4",
            "content": (
                "ISMB 300 — Landed Rate (ex-Bhilai): INR 68,500/MT excl. GST. "
                "GST @18%: INR 12,330/MT. Landed Rate incl. GST: INR 80,830/MT. "
                "Valid: July–September 2024."
            )
        },
        {
            "source": "MECON_Price_Schedule_2024_Q3.pdf — Page 9",
            "content": (
                "4 inch CS Pipe SCH 40 — Landed Rate: INR 92,000/MT excl. GST. "
                "GST @18%: INR 16,560/MT. Landed Rate incl. GST: INR 1,08,560/MT."
            )
        },
        {
            "source": "MECON_Price_Schedule_2024_Q3.pdf — Page 11",
            "content": (
                "Gate Valve 4 inch Class 150 — Unit Rate: INR 14,200 excl. GST. "
                "GST @18%: INR 2,556. Unit Rate incl. GST: INR 16,756."
            )
        },
    ],

    "ei_civil": [
        {
            "source": "MECON_Cable_Schedule_BF_Area.pdf — Page 7",
            "content": (
                "Power Cable: 3.5C x 95 sq.mm XLPE/SWA/PVC, 1.1 kV grade. "
                "Conductor: Aluminium. Standard: IS 7098 Part 1. "
                "Current rating (ground): 205 A."
            )
        },
        {
            "source": "MECON_Civil_Foundation_Spec.pdf — Page 3",
            "content": (
                "Equipment Foundation — Grade M25 concrete (IS 456). "
                "Reinforcement: Fe 500 TMT bars. Bearing capacity assumed: 15 T/m². "
                "Foundation depth: 1.5 m below FGL."
            )
        },
    ],
}

# Fallback for "All Categories" — returns a sample from each
ALL_CATEGORIES_SAMPLE = [
    MOCK_DATA["piping_valves"][0],
    MOCK_DATA["structural_steel"][0],
    MOCK_DATA["bf_process"][0],
    MOCK_DATA["price_schedules"][0],
    MOCK_DATA["ei_civil"][0],
]
