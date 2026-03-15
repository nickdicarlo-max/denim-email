/**
 * Races a promise against a timer. On timeout, throws a descriptive error
 * that names the operation and duration so test output is never ambiguous.
 *
 * Usage:
 *   await withTimeout(api.post("/api/interview/hypothesis", input), 120_000, "POST /api/interview/hypothesis (live Claude)")
 *
 * On timeout:
 *   Error: TIMEOUT: POST /api/interview/hypothesis (live Claude) did not respond within 120s
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> {
	let timerId: ReturnType<typeof setTimeout>;

	const timeout = new Promise<never>((_, reject) => {
		timerId = setTimeout(
			() =>
				reject(
					new Error(
						`TIMEOUT: ${label} did not respond within ${ms / 1000}s`,
					),
				),
			ms,
		);
	});

	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timerId!);
	}
}
