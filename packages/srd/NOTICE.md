# Avisos de atribución

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at
https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License
(https://creativecommons.org/licenses/by/4.0/legalcode).

`src/monsters.gen.ts` y `src/spells.gen.ts` se generan con `node tools/srd-import.mjs` a partir de los JSON
`src/2024/en` de https://github.com/5e-bits/5e-database (código bajo licencia MIT), convertidos al esquema de Lantern
(se descartan rasgos, textos y multiataques; los conjuros se reducen a metadatos y, si tienen daño o curación, a una acción).
Nombres y tipos generados quedan en inglés; los monstruos y conjuros de `src/compendium.ts` están escritos a mano.
