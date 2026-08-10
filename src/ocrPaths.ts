const basePath = import.meta.env.BASE_URL.replace(/\/$/u, '')

export function appPath(pathname: string) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${basePath}${path}` || '/'
}

export function routePathname() {
  const pathname = window.location.pathname
  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    return pathname.slice(basePath.length) || '/'
  }
  return pathname
}
