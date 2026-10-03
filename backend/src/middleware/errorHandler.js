// Centralized error handler. Route handlers should call next(err) on
// failure instead of building their own error responses.
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  // Expected 4xx outcomes (validation, conflicts) are not worth a stack trace.
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
  });
}
