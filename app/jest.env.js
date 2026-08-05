// Doit être posé avant que React ne soit chargé, donc dans `setupFiles` et non
// `setupFilesAfterEach` : React 19 lit ce drapeau au moment où il décide de
// prévenir qu'une mise à jour d'état n'est pas encadrée par act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
