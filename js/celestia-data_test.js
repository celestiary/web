import Testing from './testing.mjs';
import {info} from './log.mjs';
import {readAsterismsFile} from './celestia-data.mjs';

const tests = new Testing();

tests.add('Ursa minor', () => {
    /*
    const ursaMinorNames =
    [[ "ALF UMi", "DEL UMi", "EPS UMi",
       "ZET UMi", "BET UMi", "GAM UMi",
       "ETA UMi", "ZET UMi" ]];
    */
    const astr = `
"Ursa Minor"
[
[ "Alpha UMi" "Delta UMi" "Epsilon UMi" "Zeta UMi" "Beta UMi" "Gamma UMi" "Eta UMi" "Zeta UMi" ]
]
`;
    const records = readAsterismsFile(astr);
    console.log(records);
  });

tests.run();
