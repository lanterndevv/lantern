// Generador de nombres: tablas sencillas por especie (varios nombres de ejemplo vienen del SRD, CC-BY-4.0, Wizards of the Coast).
export const NAME_TABLES: Record<string, { name: string; first: string[]; last: string[] }> = {
  human: { name: 'Humano', first: ['Aldric', 'Berta', 'Corwin', 'Dalia', 'Edmund', 'Fenna', 'Godric', 'Helena', 'Ivo', 'Joran', 'Kaela', 'Loren', 'Marta', 'Osric', 'Petra', 'Renn'],
    last: ['Alderwood', 'Blackmere', 'Coldwater', 'Dunmoor', 'Fairhaven', 'Greystone', 'Hollowbrook', 'Ironhand', 'Longfield', 'Marlow', 'Northcott', 'Redmane'] },
  dwarf: { name: 'Enano', first: ['Bardin', 'Dagna', 'Fargrim', 'Gundra', 'Harbek', 'Ildra', 'Korgan', 'Mardra', 'Norgrim', 'Olga', 'Rurik', 'Thorda', 'Ulfgar', 'Vistra'],
    last: ['Piedrafirme', 'Yunquealto', 'Barbaférrea', 'Puñodeplata', 'Cantoprofundo', 'Martilloardiente', 'Veta-de-oro', 'Escudorroto', 'Brasanegra', 'Cimaheladada'] },
  elf: { name: 'Elfo', first: ['Aelar', 'Caelynn', 'Erevan', 'Faelis', 'Ilyana', 'Laucian', 'Miriel', 'Naivara', 'Quillathe', 'Riluan', 'Sylvara', 'Thamior', 'Valanthe', 'Zephyr'],
    last: ['Luzdeluna', 'Hojaplateada', 'Cantoalba', 'Sombraverde', 'Vientodulce', 'Raízprofunda', 'Estrellafugaz', 'Rocíomatinal', 'Ramaalta', 'Brumaclara'] },
  halfling: { name: 'Mediano', first: ['Andry', 'Bree', 'Cade', 'Dilly', 'Eldon', 'Finnan', 'Garret', 'Helma', 'Jillian', 'Lyle', 'Merric', 'Nedda', 'Perrin', 'Rosie'],
    last: ['Buenaparra', 'Trébolverde', 'Pasoligero', 'Colinabaja', 'Cestadepan', 'Manzanar', 'Pieslanudos', 'Tazadulce', 'Brotenuevo', 'Ollaancha'] },
  gnome: { name: 'Gnomo', first: ['Alvyn', 'Bimpnottin', 'Dimble', 'Ellyjobell', 'Fibblestib', 'Gerbo', 'Jebeddo', 'Kellen', 'Lilli', 'Nissa', 'Orla', 'Pock', 'Roondar', 'Zook'],
    last: ['Chispatuerca', 'Engranaje', 'Tornillín', 'Muelleloco', 'Lentejuela', 'Polvorilla', 'Remachín', 'Cachivache', 'Bobinado', 'Trastos'] },
  dragonborn: { name: 'Dracónido', first: ['Arjhan', 'Balasar', 'Donaar', 'Ghesh', 'Heskan', 'Kriv', 'Medrash', 'Nadarr', 'Pandjed', 'Patrin', 'Akra', 'Biri', 'Daar', 'Sora'],
    last: ['Clethtinthiallor', 'Daardendrian', 'Delmirev', 'Kepeshkmolik', 'Kerrhylon', 'Myastan', 'Nemmonis', 'Norixius', 'Ophinshtalajiir', 'Turnuroth'] },
  goliath: { name: 'Goliat', first: ['Aukan', 'Eglath', 'Gae-Al', 'Ilikan', 'Keothi', 'Lo-Kag', 'Manneo', 'Nalla', 'Orilo', 'Paavu', 'Thotham', 'Vaunea', 'Vimak', 'Maveith'],
    last: ['Cumbrenevada', 'Pasoderoca', 'Vientoalto', 'Piedracanta', 'Sombradelpico', 'Ecobarranco', 'Rugidoroca', 'Cimadura', 'Hieloviejo', 'Roblerrecio'] },
  orc: { name: 'Orco', first: ['Dench', 'Feng', 'Gell', 'Henk', 'Holg', 'Imsh', 'Krusk', 'Mhurren', 'Ront', 'Shump', 'Baggi', 'Emen', 'Ovak', 'Yevelda'],
    last: ['Colmillorroto', 'Puñodehierro', 'Garranegra', 'Tripaslargas', 'Cráneorojo', 'Rompelanzas', 'Sangreseca', 'Huesoduro', 'Lobonoche', 'Hachasucia'] },
  tiefling: { name: 'Tiflin', first: ['Akmenos', 'Amnon', 'Barakas', 'Damakos', 'Ekemon', 'Kairon', 'Leucis', 'Melech', 'Mordai', 'Morthos', 'Akta', 'Bryseis', 'Criella', 'Nemeia'],
    last: ['Brasadulce', 'Lenguaplata', 'Astasombría', 'Pactoviejo', 'Ceniciento', 'Cuernodeoro', 'Sangrecarmesí', 'Noche-en-vela', 'Azufre', 'Velolúgubre'] },
};

const pick = <T>(a: T[], rng: () => number) => a[Math.floor(rng() * a.length)];
export const genName = (species: string, rng: () => number = Math.random) => {
  const t = NAME_TABLES[species] ?? NAME_TABLES.human;
  return `${pick(t.first, rng)} ${pick(t.last, rng)}`;
};
