/**
 * Intercepts window.fetch and URL resolutions to ensure requests made in EpiFlow's
 * service tunnel (such as when rendered in Tauri WebViews or iframes) include the
 * required authentication token in the path or query parameters.
 */
export function setupServiceTunnelAuth() {
    if (typeof window === 'undefined' || !window.fetch) {
        return
    }

    const match = window.location.pathname.match(/^\/__t\/([^/]+)/)
    const pathToken = match ? match[1] : null
    const queryToken = !pathToken ? new URLSearchParams(window.location.search).get('t') : null

    if (!pathToken && !queryToken) {
        return
    }

    const originalFetch = window.fetch.bind(window)

    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        let url: string | null = null
        if (typeof input === 'string') {
            url = input
        } else if (input instanceof URL) {
            url = input.toString()
        } else if (typeof Request !== 'undefined' && input instanceof Request) {
            url = input.url
        }

        if (url) {
            const isRootRelative = url.startsWith('/') && !url.startsWith('//')
            let isSameOrigin = false
            let pathname = ''
            let search = ''

            if (isRootRelative) {
                isSameOrigin = true
                const [p, s] = url.split('?')
                pathname = p
                search = s ? `?${s}` : ''
            } else {
                try {
                    const parsed = new URL(url, window.location.origin)
                    if (parsed.origin === window.location.origin) {
                        isSameOrigin = true
                        pathname = parsed.pathname
                        search = parsed.search
                    }
                } catch {
                    // Ignore invalid URLs
                }
            }

            if (isSameOrigin && pathname && !pathname.startsWith('/__t/')) {
                if (pathToken) {
                    const newPath = `/__t/${pathToken}${pathname}${search}`
                    if (typeof input === 'string') {
                        return originalFetch(newPath, init)
                    } else if (input instanceof URL) {
                        return originalFetch(new URL(newPath, window.location.origin), init)
                    } else if (typeof Request !== 'undefined' && input instanceof Request) {
                        return originalFetch(new Request(newPath, input))
                    }
                } else if (queryToken) {
                    try {
                        const parsed = new URL(url, window.location.origin)
                        if (!parsed.searchParams.has('t')) {
                            parsed.searchParams.set('t', queryToken)
                            const target = parsed.pathname + parsed.search
                            if (typeof input === 'string') {
                                return originalFetch(target, init)
                            } else if (input instanceof URL) {
                                return originalFetch(parsed, init)
                            } else if (typeof Request !== 'undefined' && input instanceof Request) {
                                return originalFetch(new Request(parsed.toString(), input))
                            }
                        }
                    } catch {
                        // Ignore
                    }
                }
            }
        }

        return originalFetch(input, init)
    }
}

setupServiceTunnelAuth()
