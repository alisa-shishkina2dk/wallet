/**
 * Centralize logging/error reporting for log abstraction
 */
export const Logging = {
  error (error: Error): void {
    console.error(error)
  },
  info (message: string): void {
    console.log(message)
  }
}
