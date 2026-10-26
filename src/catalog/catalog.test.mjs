import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('./exercises.json', import.meta.url), 'utf8'));
const policies = JSON.parse(readFileSync(new URL('./modes.json', import.meta.url), 'utf8'));

// Independent expectations from library SR01–SR06, not values derived from the JSON.
const expected = {
  seated_forward_reach: {
    landmarks: ['shoulder', 'elbow', 'wrist', 'hip'], views: ['side'],
    metrics: { peak_elbow_angle: 'degrees', peak_forward_torso_inclination_change: 'degrees', peak_forward_wrist_displacement: 'reference_lengths', reach_duration: 'seconds' },
  },
  seated_elbow_flexion_extension: {
    landmarks: ['shoulder', 'elbow', 'wrist', 'hip'], views: ['side'],
    metrics: { minimum_elbow_angle: 'degrees', projected_bend_excursion: 'degrees', peak_forward_torso_inclination_change: 'degrees', bend_duration: 'seconds', return_duration: 'seconds' },
  },
  seated_forward_arm_raise: {
    landmarks: ['shoulder', 'elbow', 'wrist', 'hip'], views: ['side'],
    metrics: { peak_upper_arm_to_trunk_angle: 'degrees', peak_wrist_elevation: 'reference_lengths', peak_forward_torso_inclination_change: 'degrees', raise_duration: 'seconds', return_duration: 'seconds' },
  },
  seated_knee_extension: {
    landmarks: ['hip', 'knee', 'ankle'], views: ['side'],
    metrics: { peak_knee_angle: 'degrees', projected_extension_excursion: 'degrees', extension_duration: 'seconds', return_duration: 'seconds' },
  },
  seated_single_leg_lift: {
    landmarks: ['shoulder', 'hip', 'knee', 'ankle'], views: ['side', 'slightly_oblique'],
    metrics: { peak_knee_elevation: 'reference_lengths', peak_forward_torso_inclination_change: 'degrees', lift_duration: 'seconds', return_duration: 'seconds' },
  },
  seated_ankle_pumps: {
    landmarks: ['knee', 'ankle', 'heel', 'foot_index'], views: ['close_side'],
    metrics: { oriented_shank_to_foot_angle: 'degrees', signed_shank_to_foot_change: 'degrees', peak_prescribed_direction_excursion: 'degrees', outward_duration: 'seconds', return_duration: 'seconds' },
  },
};
const commonEvidence = ['definition_review', 'quan_p_adapter', 'engineering_settings', 'exercise_fixtures', 'camera_calibration_rejection', 'replay_timing', 'physical_iphone_safari'];
const clone = (value) => structuredClone(value);
const text = (value) => assert.ok(typeof value === 'string' && value.trim().length > 0, 'nonempty text required');
const texts = (value) => { assert.ok(Array.isArray(value) && value.length > 0, 'nonempty text array required'); value.forEach(text); };
const sameSet = (actual, wanted) => {
  assert.ok(Array.isArray(actual), 'array required');
  assert.equal(new Set(actual).size, actual.length, 'duplicate values');
  assert.deepEqual([...actual].sort(), [...wanted].sort());
};
const evidenceKinds = (exercise) => exercise.id === 'seated_ankle_pumps' ? [...commonEvidence, 'ankle_close_view_feasibility'] : [...commonEvidence];

// Test-local consistency checks. These are not runtime schemas or release approval.
function checkEvidence(exercise) {
  assert.ok(Array.isArray(exercise.validationEvidence));
  const kinds = evidenceKinds(exercise);
  const ids = new Set();
  const seenKinds = new Set();
  for (const evidence of exercise.validationEvidence) {
    text(evidence.id);
    assert.ok(!ids.has(evidence.id), 'duplicate evidence ID');
    ids.add(evidence.id);
    assert.ok(kinds.includes(evidence.kind), 'unknown evidence kind');
    assert.ok(!seenKinds.has(evidence.kind), 'duplicate evidence kind');
    seenKinds.add(evidence.kind);
    assert.equal(evidence.exerciseId, exercise.id, 'exercise-specific evidence required');
    assert.equal(evidence.definitionVersion, exercise.definitionVersion, 'version-matched evidence required');
    assert.equal(evidence.result, 'passed');
    text(evidence.reference);
    text(evidence.observedScope);
    if (evidence.kind === 'engineering_settings') text(evidence.settingsVersion);
    if (['physical_iphone_safari', 'ankle_close_view_feasibility'].includes(evidence.kind)) {
      assert.ok(evidence.device && typeof evidence.device === 'object');
      for (const field of ['model', 'iosVersion', 'browserVersion', 'origin', 'date']) text(evidence.device[field]);
      assert.equal(evidence.device.browser, 'Safari');
      assert.match(evidence.device.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(Number.isFinite(Date.parse(evidence.device.date)), 'valid device trial date required');
      assert.ok(['http:', 'https:'].includes(new URL(evidence.device.origin).protocol));
    }
  }
  return seenKinds;
}

function readiness(exercise) {
  const observed = checkEvidence(exercise);
  const missing = evidenceKinds(exercise).filter((kind) => !observed.has(kind));
  const blockers = [
    ...(exercise.clinicalReviewStatus === 'pending' ? ['clinical_review_pending'] : []),
    ...(exercise.technicalStatus === 'pending' ? ['technical_validation_pending'] : []),
    ...missing.map((kind) => `missing_${kind}`),
  ];
  return { available: blockers.length === 0, blockers, observed };
}

function checkExercise(exercise) {
  assert.ok(Object.hasOwn(expected, exercise.id), 'specified machine ID required');
  const specification = expected[exercise.id];
  assert.equal(exercise.definitionVersion, '1.0.0');
  text(exercise.displayName); text(exercise.description);
  sameSet(exercise.supportedModeIds, ['rehabilitation', 'wellness']);
  assert.equal(exercise.posture.position, 'seated'); texts(exercise.posture.requirements);
  sameSet(exercise.camera.allowedViews, specification.views);
  assert.equal(exercise.camera.selectionRecordedBeforeCapture, true);
  assert.equal(exercise.camera.fixedDuringTask, true); texts(exercise.camera.requirements);
  assert.ok(Array.isArray(exercise.requiredLandmarks));
  sameSet(exercise.requiredLandmarks.map((point) => point.role), specification.landmarks);
  for (const landmark of exercise.requiredLandmarks) {
    assert.equal(landmark.anatomicalSide, 'selected_side'); text(landmark.purpose);
  }
  assert.equal(exercise.sideSelection.required, true);
  sameSet(exercise.sideSelection.allowed, ['left', 'right']);
  assert.equal(exercise.sideSelection.automaticBilateralComparison, false);
  assert.equal(exercise.sideSelection.missingSidePolicy, 'reject_without_opposite_side_substitution');
  assert.equal(exercise.supportRequirements.recordDescription, true);
  assert.equal(exercise.supportRequirements.clinicianSelected, true);
  assert.equal(exercise.supportRequirements.changeRequiresNewSetup, true);
  text(exercise.supportRequirements.instruction);
  sameSet(exercise.calibrationRequirements.baselineLandmarks, specification.landmarks);
  assert.equal(exercise.calibrationRequirements.fixedSessionCalibration, true);
  assert.equal(exercise.calibrationRequirements.numericDefaults, null);
  texts(exercise.calibrationRequirements.requirements); texts(exercise.calibrationRequirements.assignmentFields);
  assert.ok(Array.isArray(exercise.metrics));
  sameSet(exercise.metrics.map((metric) => metric.id), Object.keys(specification.metrics));
  for (const metric of exercise.metrics) {
    assert.equal(metric.unit, specification.metrics[metric.id], `unit for ${metric.id}`);
    text(metric.label); text(metric.definition); text(metric.window); texts(metric.limitations);
    texts(metric.sourceReferenceIds);
    assert.ok(metric.sourceReferenceIds.every((id) => ['exercise_library', 'reach_guide'].includes(id)));
    if (metric.id.endsWith('_duration')) {
      assert.equal(metric.window, metric.id === 'return_duration'
        ? 'confirmed_return_departure_from_endpoint_to_rest_excluding_hold'
        : 'accepted_onset_to_first_endpoint_excluding_hold');
    } else if (!['oriented_shank_to_foot_angle', 'signed_shank_to_foot_change'].includes(metric.id)) {
      assert.equal(metric.window, 'accepted_onset_to_first_endpoint_inclusive');
    } else assert.equal(metric.window, 'accepted_outward_samples');
  }
  assert.equal(exercise.measurementWindows.peak, 'accepted_onset_to_first_endpoint_inclusive');
  assert.equal(exercise.measurementWindows.outwardDuration, 'accepted_onset_to_first_endpoint_excluding_hold');
  assert.equal(exercise.measurementWindows.returnDuration, 'confirmed_return_departure_from_endpoint_to_rest_excluding_hold');
  texts(exercise.stateSequence); assert.equal(exercise.stateSequence[0], 'REST'); assert.equal(exercise.stateSequence.at(-1), 'REST');
  texts(exercise.exclusionReasons); texts(exercise.limitations); texts(exercise.sourceReferenceIds);
  assert.ok(exercise.sourceReferenceIds.includes('exercise_library'));
  assert.ok(['pending', 'approved'].includes(exercise.clinicalReviewStatus));
  assert.ok(['pending', 'validated'].includes(exercise.technicalStatus));
  sameSet(exercise.availability.requiredEvidenceKinds, evidenceKinds(exercise));
  const status = readiness(exercise);
  if (exercise.clinicalReviewStatus === 'approved') assert.ok(status.observed.has('definition_review'), 'clinical approval requires review evidence');
  if (exercise.technicalStatus === 'validated') {
    assert.ok(evidenceKinds(exercise).filter((kind) => kind !== 'definition_review').every((kind) => status.observed.has(kind)), 'technical validation requires all technical evidence');
  }
  assert.equal(exercise.availability.status, status.available ? 'available' : 'blocked');
  sameSet(exercise.availability.blockers, status.blockers);
  if (exercise.id === 'seated_forward_arm_raise') {
    assert.equal(exercise.endpointDriver.selectionRequiredBeforeCapture, true);
    sameSet(exercise.endpointDriver.allowedMetricIds, ['peak_upper_arm_to_trunk_angle', 'peak_wrist_elevation']);
    assert.equal(exercise.endpointDriver.immutableDuringAttempt, true);
  }
  if (exercise.id === 'seated_ankle_pumps') {
    assert.equal(exercise.feasibilityGate.required, true);
    assert.equal(exercise.feasibilityGate.evidenceKind, 'ankle_close_view_feasibility');
    assert.equal(exercise.feasibilityGate.syntheticGeometrySufficient, false);
    texts(exercise.feasibilityGate.requirements);
    for (const field of ['footwear', 'screen_forward_sign', 'pump_direction_sign', 'lower_leg_foot_support']) assert.ok(exercise.calibrationRequirements.assignmentFields.includes(field));
  }
}

function checkCatalog(data) {
  assert.equal(data.schemaVersion, '1.0.0');
  assert.equal(data.catalogConventions.metricIdScope, 'catalog_local');
  assert.equal(data.catalogConventions.sharedContractMapping, 'pending_integration');
  assert.equal(data.catalogConventions.landmarkScope, 'anatomical_roles_not_sdk_indices');
  assert.equal(data.catalogConventions.measurementDefinitionsImplemented, false);
  text(data.catalogConventions.coordinateConvention);
  sameSet(data.sourceReferences.map((source) => source.id), ['exercise_library', 'prd', 'technology_decisions', 'reach_guide']);
  data.sourceReferences.forEach((source) => { text(source.path); text(source.revision); });
  assert.equal(data.exercises.length, 6);
  sameSet(data.exercises.map((exercise) => exercise.id), Object.keys(expected));
  data.exercises.forEach(checkExercise);
}

function checkPolicies(data) {
  assert.equal(data.schemaVersion, '1.0.0');
  sameSet(data.sourceReferences.map((source) => source.id), ['exercise_library', 'prd']);
  data.sourceReferences.forEach((source) => { text(source.path); text(source.revision); });
  sameSet(data.modes.map((mode) => mode.id), ['rehabilitation', 'wellness']);
  for (const mode of data.modes) {
    text(mode.displayName); text(mode.purpose); texts(mode.limitations);
    sameSet(mode.sourceReferenceIds, ['exercise_library', 'prd']);
    assert.equal(mode.explicitSelectionRequired, true); assert.equal(mode.supervisionRequired, true);
    const attestation = mode.clinicianSuitabilityAttestation;
    assert.equal(attestation.required, true);
    sameSet(attestation.requiredFields, ['date', 'context', 'pseudonymous_supervisor_label']);
    assert.equal(attestation.recordType, 'reported_supervisor_attestation');
    assert.equal(attestation.checkboxVerifiesClinicianIdentity, false);
    assert.equal(attestation.checkboxVerifiesMedicalClearance, false);
    assert.equal(attestation.recentStrokeSuitabilityAuthority, 'treating_team');
    const assignment = mode.assignment;
    assert.equal(assignment.modeSpecificGoalAndSettingsRequired, true);
    assert.equal(assignment.snapshotExerciseDefinitionAndSettings, true);
    assert.equal(assignment.reusePrescriptionAcrossModesAutomatically, false);
    sameSet(assignment.requiredContextFields, ['side', 'seating_support', 'clinician_selected_range_or_goal', 'assigned_repetitions_rest_if_any', 'review_criteria']);
    assert.equal(assignment.oneActiveExercise, true);
    assert.equal(assignment.taskChangeEndsTaskAndRequiresSetup, true);
    for (const key of ['prescriptionAllowed', 'progressionAllowed', 'modeSwitchAllowed', 'recognitionMaySwitchMode', 'efficacyClaimsAllowed']) assert.equal(mode.automation[key], false);
    assert.equal(mode.manualActivityLogging.allowed, true);
    assert.equal(mode.manualActivityLogging.explicitLabelRequired, true);
    assert.equal(mode.manualActivityLogging.recordType, 'manual_activity_log');
    for (const key of ['countsAsMeasuredRepetitions', 'includedInMeasuredAttemptCounts', 'includedInMeasuredDenominators', 'substitutesForUnavailableAnalyzer']) assert.equal(mode.manualActivityLogging[key], false);
  }
}

// All references below are intentionally synthetic in-memory consistency fixtures.
// Passing these checks never establishes that the named evidence exists or is valid.
function fullyEvidencedFixture(original) {
  const exercise = clone(original);
  exercise.validationEvidence = evidenceKinds(exercise).map((kind) => ({
    id: `synthetic_${kind}`, kind, exerciseId: exercise.id, definitionVersion: exercise.definitionVersion,
    result: 'passed', reference: `synthetic-fixture://${kind}`, observedScope: 'Synthetic test record only; no clinical or device claim.',
    ...(kind === 'engineering_settings' ? { settingsVersion: 'synthetic-1' } : {}),
    ...(['physical_iphone_safari', 'ankle_close_view_feasibility'].includes(kind) ? { device: {
      model: 'Synthetic model', iosVersion: 'Synthetic iOS', browser: 'Safari', browserVersion: 'Synthetic Safari', origin: 'https://example.invalid', date: '2026-10-24',
    } } : {}),
  }));
  exercise.clinicalReviewStatus = 'approved'; exercise.technicalStatus = 'validated';
  exercise.availability.status = 'available'; exercise.availability.blockers = [];
  return exercise;
}
const exerciseById = (id) => catalog.exercises.find((exercise) => exercise.id === id);

test('JSON parses and six exact unique exercise IDs satisfy required fields, landmarks, metric units and windows', () => checkCatalog(catalog));
test('both supervised explicit modes require unverified suitability attestation and keep manual logs separate', () => checkPolicies(policies));
test('every shipped analyzer starts clinically and technically pending, blocked and without completed evidence', () => {
  for (const exercise of catalog.exercises) {
    assert.equal(exercise.clinicalReviewStatus, 'pending'); assert.equal(exercise.technicalStatus, 'pending');
    assert.equal(exercise.availability.status, 'blocked'); assert.deepEqual(exercise.validationEvidence, []);
    assert.equal(readiness(exercise).available, false);
  }
});
test('changing a display name cannot enable an analyzer', () => {
  const exercise = clone(catalog.exercises[0]); exercise.displayName = 'Available';
  checkExercise(exercise); assert.equal(readiness(exercise).available, false);
  exercise.availability.status = 'available'; assert.throws(() => checkExercise(exercise));
});
test('complete synthetic evidence can satisfy the consistency checker for every exercise', () => {
  for (const original of catalog.exercises) {
    const exercise = fullyEvidencedFixture(original); checkExercise(exercise);
    assert.equal(readiness(exercise).available, true);
    exercise.displayName = 'A different descriptive name'; checkExercise(exercise);
  }
});
test('ankle pumps require foot landmarks, calibrated direction, oriented-angle metrics and physical feasibility', () => {
  const ankle = exerciseById('seated_ankle_pumps'); checkExercise(ankle);
  const fixture = fullyEvidencedFixture(ankle);
  fixture.validationEvidence = fixture.validationEvidence.filter((evidence) => evidence.kind !== 'ankle_close_view_feasibility');
  assert.throws(() => checkExercise(fixture));
  for (const landmark of ['heel', 'foot_index']) {
    const missing = clone(ankle); missing.requiredLandmarks = missing.requiredLandmarks.filter((point) => point.role !== landmark);
    assert.throws(() => checkExercise(missing));
  }
  const unsigned = clone(ankle); unsigned.metrics[0].id = 'unsigned_ankle_angle'; assert.throws(() => checkExercise(unsigned));
});
test('knee extension and single-leg lift preserve their different lower-limb requirements', () => {
  const knee = exerciseById('seated_knee_extension'); const lift = exerciseById('seated_single_leg_lift');
  assert.deepEqual(knee.requiredLandmarks.map((point) => point.role), ['hip', 'knee', 'ankle']);
  assert.deepEqual(lift.requiredLandmarks.map((point) => point.role), ['shoulder', 'hip', 'knee', 'ankle']);
  assert.ok(lift.calibrationRequirements.assignmentFields.includes('fixed_reference'));
  for (const original of [knee, lift]) {
    const fixture = clone(original); fixture.requiredLandmarks = clone(catalog.exercises[0].requiredLandmarks);
    assert.throws(() => checkExercise(fixture));
  }
});
test('malformed duplicate exercise IDs are rejected', () => {
  const fixture = clone(catalog); fixture.exercises[1].id = fixture.exercises[0].id;
  assert.throws(() => checkCatalog(fixture));
});
test('missing required fields, empty metric definitions and missing landmark declarations are rejected', () => {
  for (const field of ['displayName', 'description', 'posture', 'camera', 'supportRequirements', 'calibrationRequirements', 'availability', 'validationEvidence', 'sourceReferenceIds']) {
    const fixture = clone(catalog.exercises[0]); delete fixture[field]; assert.throws(() => checkExercise(fixture), field);
  }
  const empty = clone(catalog.exercises[0]); empty.metrics[0].definition = ''; assert.throws(() => checkExercise(empty));
  const missing = clone(catalog.exercises[0]); missing.requiredLandmarks.pop(); assert.throws(() => checkExercise(missing));
  const wrongSide = clone(catalog.exercises[0]); wrongSide.requiredLandmarks[0].anatomicalSide = 'opposite_side'; assert.throws(() => checkExercise(wrongSide));
});
test('invalid units, valid-but-swapped units and duplicate metric IDs are rejected', () => {
  for (const unit of ['centimeters', 'seconds']) {
    const fixture = clone(catalog.exercises[0]); fixture.metrics[0].unit = unit; assert.throws(() => checkExercise(fixture));
  }
  const duplicate = clone(catalog.exercises[0]); duplicate.metrics[1].id = duplicate.metrics[0].id; assert.throws(() => checkExercise(duplicate));
});
test('inconsistent status, unsupported status and missing blockers are rejected', () => {
  const changes = [
    (exercise) => { exercise.clinicalReviewStatus = 'approved'; },
    (exercise) => { exercise.technicalStatus = 'validated'; },
    (exercise) => { exercise.technicalStatus = 'ready'; },
    (exercise) => { exercise.availability.status = 'available'; },
    (exercise) => { exercise.availability.blockers = []; },
  ];
  for (const mutate of changes) { const fixture = clone(catalog.exercises[0]); mutate(fixture); assert.throws(() => checkExercise(fixture)); }
});
test('readiness rejects missing or wrong-exercise/wrong-version evidence, missing references and incomplete device trials', () => {
  const changes = [
    (exercise) => { exercise.validationEvidence.pop(); },
    (exercise) => { exercise.validationEvidence[0].exerciseId = 'seated_knee_extension'; },
    (exercise) => { exercise.validationEvidence[0].definitionVersion = '0.0.0'; },
    (exercise) => { exercise.validationEvidence[0].reference = ''; },
    (exercise) => { exercise.validationEvidence[0].observedScope = ''; },
    (exercise) => { exercise.validationEvidence[0].result = 'pending'; },
    (exercise) => { exercise.validationEvidence.find((evidence) => evidence.kind === 'engineering_settings').settingsVersion = ''; },
    (exercise) => { exercise.validationEvidence.push(clone(exercise.validationEvidence[0])); },
    ...['model', 'iosVersion', 'browser', 'browserVersion', 'origin', 'date'].map((field) => (exercise) => {
      delete exercise.validationEvidence.find((evidence) => evidence.kind === 'physical_iphone_safari').device[field];
    }),
  ];
  for (const mutate of changes) { const fixture = fullyEvidencedFixture(catalog.exercises[0]); mutate(fixture); assert.throws(() => checkExercise(fixture)); }
});
test('mode fixtures reject implicit selection, missing suitability, verified-clearance claims and measured manual logs', () => {
  const changes = [
    (mode) => { mode.explicitSelectionRequired = false; },
    (mode) => { mode.clinicianSuitabilityAttestation.required = false; },
    (mode) => { mode.clinicianSuitabilityAttestation.requiredFields.pop(); },
    (mode) => { mode.clinicianSuitabilityAttestation.checkboxVerifiesMedicalClearance = true; },
    (mode) => { mode.clinicianSuitabilityAttestation.recentStrokeSuitabilityAuthority = 'app'; },
    (mode) => { mode.automation.modeSwitchAllowed = true; },
    (mode) => { mode.manualActivityLogging.countsAsMeasuredRepetitions = true; },
  ];
  for (const mutate of changes) { const fixture = clone(policies); mutate(fixture.modes[0]); assert.throws(() => checkPolicies(fixture)); }
});
