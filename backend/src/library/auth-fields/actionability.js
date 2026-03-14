export function isFieldActionable(field = {}) {
  return (
    Boolean(field?.actionable) &&
    Boolean(field?.visible) &&
    Boolean(field?.enabled) &&
    !Boolean(field?.readOnly)
  );
}

export function isControlActionable(control = {}) {
  return Boolean(control?.actionable) && Boolean(control?.visible) && Boolean(control?.enabled);
}
