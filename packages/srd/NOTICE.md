# Avisos de atribución

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at
https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License
(https://creativecommons.org/licenses/by/4.0/legalcode).

`src/monsters.gen.ts`, `src/spells.gen.ts` y `src/spelltext.gen.ts` se generan con `node tools/srd-import.mjs` a partir de los JSON
`src/2024/en` de https://github.com/5e-bits/5e-database (código bajo licencia MIT), convertidos al esquema de Lantern:
- monstruos: estadísticas, acciones con daño, multiataque, rasgos y acciones legendarias (texto en inglés);
- conjuros: metadatos, una acción si tienen daño o curación y el aumento por nivel de espacio (`SPELL_UP`);
- `spelltext.gen.ts`: descripción y «a niveles superiores» de cada conjuro, en inglés (la web lo carga aparte).

Nombres, tipos y textos generados quedan en inglés (los campos fijos y algunos nombres se traducen en `src/es.ts`);
los monstruos y conjuros de `src/compendium.ts` están escritos a mano.
