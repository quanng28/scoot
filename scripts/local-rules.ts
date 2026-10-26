import {buildSyntheticUpperBodyFixture} from '../src/analysis/synthetic-upper-body.js';
import {recognizeUpperBody} from '../src/recognition/local-rules/upper-body.js';
const fixture=buildSyntheticUpperBodyFixture();
// Print the labeled engineering outcome, never camera observations or a provider request.
process.stdout.write(JSON.stringify({fixtureStatus:fixture.fixtureStatus,result:recognizeUpperBody(fixture.window)},null,2)+'\n');
