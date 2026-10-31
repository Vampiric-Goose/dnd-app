// Registry of the official 2014 5e sources (5etools source ids). It is the import whitelist (R52): content from any source that is
// not listed here (and not declared as homebrew by its own file) is never imported, so 2024 rules cannot get into the app.
// Pure data and helpers (no UI, no db): Node scripts and the importer share it. Only ids, names, kinds and release dates live here.
//
// Scope: every WotC book and adventure published before 2024-09-17 (the 2024 Player's Handbook release). Screens, recipe books and
// the tarot deck are rules-neutral but harmless, so they are listed with kind 'other'. Unearthed Arcana (playtest) is not listed.

export type SourceKind = 'core' | 'supplement' | 'setting' | 'adventure' | 'other';
/** `id` is the 5etools spelling, only where it is mixed case (the record key is upper-cased). */
export interface SourceEntry { id?: string; name: string; kind: SourceKind; published: string /* YYYY-MM-DD */ }

export const OFFICIAL_2014: Record<string, SourceEntry> = {
  'LMOP': { id: 'LMoP', name: "Lost Mine of Phandelver", kind: 'adventure', published: '2014-07-15' },
  'HOTDQ': { id: 'HotDQ', name: "Hoard of the Dragon Queen", kind: 'adventure', published: '2014-08-19' },
  'PHB': { name: "Player's Handbook (2014)", kind: 'core', published: '2014-08-19' },
  'MM': { name: "Monster Manual (2014)", kind: 'core', published: '2014-09-30' },
  'ROT': { id: 'RoT', name: "Rise of Tiamat", kind: 'adventure', published: '2014-11-04' },
  'DMG': { name: "Dungeon Master's Guide (2014)", kind: 'core', published: '2014-12-09' },
  'SCREEN': { id: 'Screen', name: "Dungeon Master's Screen", kind: 'other', published: '2015-01-20' },
  'POTA': { id: 'PotA', name: "Princes of the Apocalypse", kind: 'adventure', published: '2015-04-07' },
  'OOTA': { id: 'OotA', name: "Out of the Abyss", kind: 'adventure', published: '2015-09-15' },
  'SCAG': { name: "Sword Coast Adventurer's Guide", kind: 'setting', published: '2015-11-03' },
  'COS': { id: 'CoS', name: "Curse of Strahd", kind: 'adventure', published: '2016-03-15' },
  'PSZ': { name: "Plane Shift: Zendikar", kind: 'setting', published: '2016-04-27' },
  'PSI': { name: "Plane Shift: Innistrad", kind: 'setting', published: '2016-07-12' },
  'AL': { name: "Adventurers League", kind: 'other', published: '2016-08-26' },
  'SKT': { name: "Storm King's Thunder", kind: 'adventure', published: '2016-09-06' },
  'VGM': { name: "Volo's Guide to Monsters", kind: 'supplement', published: '2016-11-15' },
  'PSK': { name: "Plane Shift: Kaladesh", kind: 'setting', published: '2017-02-16' },
  'TFTYP-ATG': { id: 'TftYP-AtG', name: "Tales from the Yawning Portal: Against the Giants", kind: 'adventure', published: '2017-03-24' },
  'TFTYP-DIT': { id: 'TftYP-DiT', name: "Tales from the Yawning Portal: Dead in Thay", kind: 'adventure', published: '2017-03-24' },
  'TFTYP-TFOF': { id: 'TftYP-TFoF', name: "Tales from the Yawning Portal: The Forge of Fury", kind: 'adventure', published: '2017-03-24' },
  'TFTYP-THSOT': { id: 'TftYP-THSoT', name: "Tales from the Yawning Portal: The Hidden Shrine of Tamoachan", kind: 'adventure', published: '2017-03-24' },
  'TFTYP-TOH': { id: 'TftYP-ToH', name: "Tales from the Yawning Portal: Tomb of Horrors", kind: 'adventure', published: '2017-03-24' },
  'TFTYP-TSC': { id: 'TftYP-TSC', name: "Tales from the Yawning Portal: The Sunless Citadel", kind: 'adventure', published: '2017-03-24' },
  'TFTYP-WPM': { id: 'TftYP-WPM', name: "Tales from the Yawning Portal: White Plume Mountain", kind: 'adventure', published: '2017-03-24' },
  'PSA': { name: "Plane Shift: Amonkhet", kind: 'setting', published: '2017-07-06' },
  'TOA': { id: 'ToA', name: "Tomb of Annihilation", kind: 'adventure', published: '2017-09-19' },
  'OGA': { name: "One Grung Above", kind: 'supplement', published: '2017-10-11' },
  'TTP': { name: "The Tortle Package", kind: 'adventure', published: '2017-11-03' },
  'XGE': { name: "Xanathar's Guide to Everything", kind: 'supplement', published: '2017-11-21' },
  'TLK': { name: "The Lost Kenku", kind: 'adventure', published: '2017-11-28' },
  'XMTS': { id: 'XMtS', name: "X Marks the Spot", kind: 'adventure', published: '2017-12-11' },
  'PSX': { name: "Plane Shift: Ixalan", kind: 'setting', published: '2018-01-09' },
  'MTF': { name: "Mordenkainen's Tome of Foes", kind: 'supplement', published: '2018-05-29' },
  'PSD': { name: "Plane Shift: Dominaria", kind: 'setting', published: '2018-07-31' },
  'WDH': { name: "Waterdeep: Dragon Heist", kind: 'adventure', published: '2018-09-18' },
  'LLK': { name: "Lost Laboratory of Kwalish", kind: 'adventure', published: '2018-11-10' },
  'WDMM': { name: "Waterdeep: Dungeon of the Mad Mage", kind: 'adventure', published: '2018-11-13' },
  'GGR': { name: "Guildmasters' Guide to Ravnica", kind: 'setting', published: '2018-11-20' },
  'KKW': { name: "Krenko's Way", kind: 'adventure', published: '2018-11-20' },
  'SAC': { name: "Sage Advice Compendium (2014)", kind: 'other', published: '2019-01-31' },
  'AZFYT': { id: 'AZfyT', name: "A Zib for Your Thoughts", kind: 'adventure', published: '2019-03-05' },
  'GOS': { id: 'GoS', name: "Ghosts of Saltmarsh", kind: 'adventure', published: '2019-05-21' },
  'HFTT': { id: 'HftT', name: "Hunt for the Thessalhydra", kind: 'adventure', published: '2019-05-21' },
  'AI': { name: "Acquisitions Incorporated", kind: 'supplement', published: '2019-06-18' },
  'OOW': { id: 'OoW', name: "The Orrery of the Wanderer", kind: 'adventure', published: '2019-06-18' },
  'DIP': { name: "Essentials Kit: Dragon of Icespire Peak", kind: 'adventure', published: '2019-06-24' },
  'DC': { name: "Essentials Kit: Divine Contention", kind: 'adventure', published: '2019-09-03' },
  'SDW': { name: "Essentials Kit: Sleeping Dragon's Wake", kind: 'adventure', published: '2019-09-03' },
  'SLW': { name: "Essentials Kit: Storm Lord's Wrath", kind: 'adventure', published: '2019-09-03' },
  'BGDIA': { name: "Baldur's Gate: Descent Into Avernus", kind: 'adventure', published: '2019-09-18' },
  'LR': { name: "Locathah Rising", kind: 'adventure', published: '2019-09-19' },
  'AWM': { name: "Adventure with Muk", kind: 'supplement', published: '2019-11-12' },
  'IMR': { name: "Infernal Machine Rebuild", kind: 'adventure', published: '2019-11-12' },
  'EFR': { name: "Eberron: Forgotten Relics", kind: 'adventure', published: '2019-11-19' },
  'ERLW': { name: "Eberron: Rising from the Last War", kind: 'setting', published: '2019-11-19' },
  'RMBRE': { name: "The Lost Dungeon of Rickedness: Big Rick Energy", kind: 'adventure', published: '2019-11-19' },
  'RMR': { name: "Rick and Morty: Basic Rules", kind: 'supplement', published: '2019-11-19' },
  'DD': { name: "Wildemount: Dangerous Designs", kind: 'adventure', published: '2020-03-17' },
  'EGW': { name: "Explorer's Guide to Wildemount", kind: 'setting', published: '2020-03-17' },
  'FS': { name: "Wildemount: Frozen Sick", kind: 'adventure', published: '2020-03-17' },
  'TOR': { id: 'ToR', name: "Wildemount: Tide of Retribution", kind: 'adventure', published: '2020-03-17' },
  'US': { name: "Wildemount: Unwelcome Spirits", kind: 'adventure', published: '2020-03-17' },
  'MOT': { name: "Mythic Odysseys of Theros", kind: 'setting', published: '2020-06-02' },
  'IDROTF': { id: 'IDRotF', name: "Icewind Dale: Rime of the Frostmaiden", kind: 'adventure', published: '2020-09-15' },
  'SCREENDUNGEONKIT': { id: 'ScreenDungeonKit', name: "Dungeon Master's Screen: Dungeon Kit", kind: 'other', published: '2020-09-21' },
  'HF': { name: "Heroes' Feast", kind: 'other', published: '2020-10-27' },
  'SCREENWILDERNESSKIT': { id: 'ScreenWildernessKit', name: "Dungeon Master's Screen: Wilderness Kit", kind: 'other', published: '2020-11-17' },
  'TCE': { name: "Tasha's Cauldron of Everything", kind: 'supplement', published: '2020-11-17' },
  'MGELFT': { name: "Muk's Guide to Everything He Learned From Tasha", kind: 'supplement', published: '2020-12-01' },
  'CM': { name: "Candlekeep Mysteries", kind: 'adventure', published: '2021-03-16' },
  'HOL': { id: 'HoL', name: "Ravenloft: The House of Lament", kind: 'adventure', published: '2021-05-18' },
  'VRGR': { name: "Van Richten's Guide to Ravenloft", kind: 'setting', published: '2021-05-18' },
  'RTG': { id: 'RtG', name: "Return to the Glory", kind: 'adventure', published: '2021-05-21' },
  'AITFR-ISF': { id: 'AitFR-ISF', name: "Adventures in the Forgotten Realms: In Scarlet Flames", kind: 'adventure', published: '2021-06-30' },
  'AITFR-THP': { id: 'AitFR-THP', name: "Adventures in the Forgotten Realms: The Hidden Page", kind: 'adventure', published: '2021-07-07' },
  'AITFR-AVT': { id: 'AitFR-AVT', name: "Adventures in the Forgotten Realms: A Verdant Tomb", kind: 'adventure', published: '2021-07-14' },
  'AITFR-DN': { id: 'AitFR-DN', name: "Adventures in the Forgotten Realms: Deepest Night", kind: 'adventure', published: '2021-07-21' },
  'AITFR-FCD': { id: 'AitFR-FCD', name: "Adventures in the Forgotten Realms: From Cyan Depths", kind: 'adventure', published: '2021-07-28' },
  'NRH-ASS': { name: "NERDS Restoring Harmony: A Sticky Situation", kind: 'adventure', published: '2021-09-01' },
  'NRH-AT': { name: "NERDS Restoring Harmony: Adventure Together", kind: 'adventure', published: '2021-09-01' },
  'NRH-AVITW': { id: 'NRH-AVitW', name: "NERDS Restoring Harmony: A Voice in the Wilderness", kind: 'adventure', published: '2021-09-01' },
  'NRH-AWOL': { id: 'NRH-AWoL', name: "NERDS Restoring Harmony: A Web of Lies", kind: 'adventure', published: '2021-09-01' },
  'NRH-COI': { id: 'NRH-CoI', name: "NERDS Restoring Harmony: Circus of Illusion", kind: 'adventure', published: '2021-09-01' },
  'NRH-TCMC': { name: "NERDS Restoring Harmony: The Candy Mountain Caper", kind: 'adventure', published: '2021-09-01' },
  'NRH-TLT': { name: "NERDS Restoring Harmony: The Lost Tomb", kind: 'adventure', published: '2021-09-01' },
  'DOD': { id: 'DoD', name: "Domains of Delight", kind: 'supplement', published: '2021-09-21' },
  'WBTW': { id: 'WBtW', name: "The Wild Beyond the Witchlight", kind: 'adventure', published: '2021-09-21' },
  'MABJOV': { id: 'MaBJoV', name: "Minsc and Boo's Journal of Villainy", kind: 'supplement', published: '2021-10-05' },
  'FTD': { name: "Fizban's Treasury of Dragons", kind: 'supplement', published: '2021-10-26' },
  'SCC': { name: "Strixhaven: A Curriculum of Chaos", kind: 'setting', published: '2021-12-07' },
  'SCC-ARIR': { id: 'SCC-ARiR', name: "Strixhaven: A Reckoning in Ruins", kind: 'adventure', published: '2021-12-07' },
  'SCC-CK': { name: "Strixhaven: Campus Kerfuffle", kind: 'adventure', published: '2021-12-07' },
  'SCC-HFMT': { id: 'SCC-HfMT', name: "Strixhaven: Hunt for Mage Tower", kind: 'adventure', published: '2021-12-07' },
  'SCC-TMM': { name: "Strixhaven: The Magister's Masquerade", kind: 'adventure', published: '2021-12-07' },
  'MPMM': { name: "Mordenkainen Presents: Monsters of the Multiverse", kind: 'supplement', published: '2022-01-25' },
  'CRCOTN': { id: 'CRCotN', name: "Critical Role: Call of the Netherdeep", kind: 'adventure', published: '2022-03-15' },
  'MCV1SC': { name: "Monstrous Compendium Volume 1: Spelljammer Creatures", kind: 'supplement', published: '2022-04-21' },
  'TD': { name: "Tarot Deck", kind: 'other', published: '2022-05-24' },
  'JTTRC': { id: 'JttRC', name: "Journeys through the Radiant Citadel", kind: 'adventure', published: '2022-07-19' },
  'DOSI': { id: 'DoSI', name: "Dragons of Stormwreck Isle", kind: 'adventure', published: '2022-07-31' },
  'SJA': { id: 'SjA', name: "Spelljammer Academy", kind: 'adventure', published: '2022-08-01' },
  'AAG': { name: "Astral Adventurer's Guide", kind: 'setting', published: '2022-08-16' },
  'BAM': { name: "Boo's Astral Menagerie", kind: 'setting', published: '2022-08-16' },
  'LOX': { id: 'LoX', name: "Light of Xaryxis", kind: 'adventure', published: '2022-08-16' },
  'SCREENSPELLJAMMER': { id: 'ScreenSpelljammer', name: "Dungeon Master's Screen: Spelljammer", kind: 'other', published: '2022-08-16' },
  'DSOTDQ': { id: 'DSotDQ', name: "Dragonlance: Shadow of the Dragon Queen", kind: 'adventure', published: '2022-11-22' },
  'KFTGV': { id: 'KftGV', name: "Keys from the Golden Vault", kind: 'adventure', published: '2023-02-21' },
  'HAT-TG': { name: "Thieves' Gallery", kind: 'supplement', published: '2023-03-06' },
  'GOTSF': { id: 'GotSF', name: "Giants of the Star Forge", kind: 'adventure', published: '2023-08-01' },
  'BGG': { name: "Bigby Presents: Glory of the Giants", kind: 'supplement', published: '2023-08-15' },
  'PABTSO': { id: 'PaBTSO', name: "Phandelver and Below: The Shattered Obelisk", kind: 'adventure', published: '2023-09-19' },
  'MCV4EC': { name: "Monstrous Compendium Volume 4: Eldraine Creatures", kind: 'supplement', published: '2023-09-21' },
  'LK': { name: "Lightning Keep", kind: 'adventure', published: '2023-09-26' },
  'MPP': { name: "Morte's Planar Parade", kind: 'setting', published: '2023-10-07' },
  'SATO': { id: 'SatO', name: "Sigil and the Outlands", kind: 'setting', published: '2023-10-07' },
  'TOFW': { id: 'ToFW', name: "Turn of Fortune's Wheel", kind: 'adventure', published: '2023-10-07' },
  'AATM': { name: "Adventure Atlas: The Mortuary", kind: 'supplement', published: '2023-10-17' },
  'COA': { id: 'CoA', name: "Chains of Asmodeus", kind: 'adventure', published: '2023-10-30' },
  'HFFOTM': { id: 'HFFotM', name: "Heroes' Feast Flavors of the Multiverse", kind: 'other', published: '2023-11-07' },
  'BMT': { name: "The Book of Many Things", kind: 'supplement', published: '2023-11-14' },
  'DMTCRG': { name: "The Deck of Many Things: Card Reference Guide", kind: 'supplement', published: '2023-11-14' },
  'PIP': { id: 'PiP', name: "Peril in Pinebrook", kind: 'adventure', published: '2023-11-20' },
  'HFSTCM': { id: 'HFStCM', name: "Heroes' Feast: Saving the Children's Menu", kind: 'adventure', published: '2023-11-21' },
  'DITLCOT': { id: 'DitLCoT', name: "Descent into the Lost Caverns of Tsojcanth", kind: 'adventure', published: '2024-03-26' },
  'LRDT': { name: "Red Dragon's Tale: A LEGO Adventure", kind: 'adventure', published: '2024-04-01' },
  'VNOTEE': { id: 'VNotEE', name: "Vecna: Nest of the Eldritch Eye", kind: 'adventure', published: '2024-04-16' },
  'VEOR': { id: 'VEoR', name: "Vecna: Eve of Ruin", kind: 'adventure', published: '2024-05-21' },
  'QFTIS': { id: 'QftIS', name: "Quests from the Infinite Staircase", kind: 'adventure', published: '2024-07-16' },
  'PAF': { id: 'PaF', name: "Puncheons and Flagons", kind: 'other', published: '2024-08-27' },
  // R53: WotC 2014-era sources that books.json does not list under these ids (dates are the best known release dates).
  'ROTOS': { id: 'RoTOS', name: "Rise of Tiamat Online Supplement", kind: 'supplement', published: '2014-11-04' },
  'EEPC': { name: "Elemental Evil Player's Companion", kind: 'supplement', published: '2015-03-10' },
  'EET': { name: "Elemental Evil Trinkets", kind: 'supplement', published: '2015-03-10' },
  'TFTYP': { id: 'TftYP', name: "Tales from the Yawning Portal", kind: 'adventure', published: '2017-04-04' },
  'MFF': { name: "Mordenkainen's Fiendish Folio Volume 1", kind: 'supplement', published: '2018-09-20' },
  'ESK': { name: "Essentials Kit", kind: 'adventure', published: '2019-06-24' },
  'MCV2DC': { name: "Monstrous Compendium Volume 2: Dragonlance Creatures", kind: 'supplement', published: '2022-12-06' },
  'SADS': { name: "Sapphire Anniversary Dice Set", kind: 'supplement', published: '2023-01-24' },
  'HAT-LMI': { name: "Honor Among Thieves: Legendary Magic Items", kind: 'supplement', published: '2023-03-31' },
  'MCV3MC': { name: "Monstrous Compendium Volume 3: Minecraft Creatures", kind: 'supplement', published: '2023-07-18' },
  'MISMV1': { id: 'MisMV1', name: "Misplaced Monsters: Volume One", kind: 'supplement', published: '2023-10-31' },
  'VD': { name: "Vecna Dossier", kind: 'supplement', published: '2024-04-16' },
};

/** Sources of the 2024 era (published on or after 2024-09-17), listed only so skipped content can be named "2024 rules". The whitelist is what enforces. */
export const RULES_2024: ReadonlySet<string> = new Set([
  'ABH',
  'AU',
  'AUD',
  'BQDD',
  'BQGT',
  'CABOMP',
  'DRDE',
  'DRDE-ACFAS',
  'DRDE-BD',
  'DRDE-BTS',
  'DRDE-DAS',
  'DRDE-DOTSC',
  'DRDE-FWTVC',
  'DRDE-SD',
  'DRDE-TDON',
  'DRDE-TFV',
  'DRDE-TWOO',
  'EFA',
  'FFOTR',
  'FRAIF',
  'FRHOF',
  'HBTD',
  'HFLOTT',
  'HOTB',
  'LFL',
  'NF',
  'PL',
  'RHW',
  'RWG',
  'SCOEE',
  'SOS',
  'UTHFTLH',
  'WTTHC',
  'XDMG',
  'XMM',
  'XPHB',
  'XSAC',
  'XSCREEN',
  'XSCREENRHW',
]);

// 5etools names later Unearthed Arcana sources UA<year><Title>; the 2022+ ones are 2024 playtest material.
const UA_2022_ON = /^UA20(2[2-9]|[3-9]\d)/i;
const up = (s: string) => String(s).toUpperCase();

/** Ids the app itself uses as a source. */
const SPECIAL: Record<string, string> = { SRD: 'System Reference Document 5.1', HOMEBREW: 'Homebrew', HIDDEN: 'Hidden item' };

const entry = (id: string): SourceEntry | undefined => (Object.hasOwn(OFFICIAL_2014, up(id)) ? OFFICIAL_2014[up(id)] : undefined);

/** The official 2014 source with this id (any case), if it is one. */
export function sourceInfo(id: string): { name: string; kind: SourceKind; official: true } | undefined {
  const e = entry(id);
  return e && { name: e.name, kind: e.kind, official: true };
}

/** True for the 2024-rules era sources (published 2024-09-17 or later) and the 2022+ Unearthed Arcana playtests. */
export const is2024Source = (id: string): boolean => RULES_2024.has(up(id)) || UA_2022_ON.test(id);

/** Why the importer may take content from `id`: an official 2014 book, a source its own file declared, or no (2024 / unknown). */
export type SourceVerdict = 'official' | 'homebrew' | '2024' | 'unknown';
export function classifySource(id: string, declared: ReadonlySet<string> = new Set()): SourceVerdict {
  if (is2024Source(id)) return '2024'; // checked first: no file may declare, or claim, a 2024 id
  if (entry(id)) return 'official'; // and an official id is always official, never homebrew
  if (Object.hasOwn(SPECIAL, up(id))) return 'unknown'; // SRD, HOMEBREW and HIDDEN are the app's own: a file cannot declare them
  return declared.has(up(id)) ? 'homebrew' : 'unknown';
}

/** What to show for a source id. `homebrew`: the id belongs to a pack imported as homebrew. */
export function sourceLabel(id: string, homebrew = false): string {
  const s = up(id);
  if (Object.hasOwn(SPECIAL, s)) return SPECIAL[s];
  const e = entry(id);
  if (e) return e.name;
  if (is2024Source(id)) return `2024 rules (${id})`;
  return homebrew ? `Homebrew (${id})` : `Unknown source (${id})`;
}

/** Is this source one of the app's reserved ids (SRD, HOMEBREW, HIDDEN)? */
export const isReservedSource = (id: string): boolean => Object.hasOwn(SPECIAL, up(id));

/**
 * May a stored pack reach the content index? The built-in SRD pack (id `srd`, the only one that may carry source SRD), official
 * 2014 books and homebrew packs; never 2024 or unknown sources, and never another pack claiming a reserved id.
 */
export const packAllowed = (p: { id?: string; source: string; homebrew?: boolean }): boolean =>
  isReservedSource(p.source) ? p.id === 'srd' && up(p.source) === 'SRD'
    : !is2024Source(p.source) && (p.homebrew === true || !!entry(p.source));

/** May a backup restore this pack? Never the built-in SRD (it always comes from the shipped asset) nor a pack claiming a reserved source. */
export const restorablePack = (p: { id: string; source: string }): boolean => p.id !== 'srd' && !isReservedSource(p.source);

/** The source an entity or patch target id names: the text after its last `@`. */
export const idSource = (id: string): string => id.slice(id.lastIndexOf('@') + 1);

/** Is a stored entity trustworthy? Its id must carry its own source (so it cannot replace another source's entity), and that source can be neither 2024 nor reserved. */
export const entityAllowed = (e: { id: string; source: string }): boolean =>
  idSource(e.id).toUpperCase() === up(e.source) && !is2024Source(e.source) && !isReservedSource(e.source);

/** May a stored pack patch other sources' entities? Only official 2014 books can (5etools' SRD-overlap text); never homebrew or anything else. */
export const mayPatch = (p: { source: string }): boolean => !!entry(p.source) && !is2024Source(p.source);

/** Is a stored patch trustworthy? Neither its alias nor the entity it targets belongs to the 2024 rules. */
export const patchAllowed = (x: { alias: string; targetId: string }): boolean => !is2024Source(x.alias) && !is2024Source(idSource(x.targetId));
