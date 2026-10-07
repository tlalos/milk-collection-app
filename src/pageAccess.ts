export function requiresMilkCollectionAccess(screen: string, homeMenuGroup: string | null) {
  return (screen === 'home' && homeMenuGroup === 'milkCollection')
    || ['login', 'settings', 'customers', 'dataSync', 'journal', 'transport', 'suppliers', 'entry'].includes(screen)
}

