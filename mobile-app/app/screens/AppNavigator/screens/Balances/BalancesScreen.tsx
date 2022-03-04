import { getNativeIcon } from '@components/icons/assets'
import { View, Platform, RefreshControl, TouchableOpacity } from 'react-native'
import {
  ThemedIcon,
  ThemedScrollView,
  ThemedSectionTitle,
  ThemedTouchableOpacity
} from '@components/themed'
import { useDisplayBalancesContext } from '@contexts/DisplayBalancesContext'
import { useWalletContext } from '@shared-contexts/WalletContext'
import { useWalletPersistenceContext } from '@shared-contexts/WalletPersistenceContext'
import { useWhaleApiClient } from '@shared-contexts/WhaleContext'
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs'
import { StackNavigationProp, StackScreenProps } from '@react-navigation/stack'
import { ocean } from '@store/ocean'
import { fetchTokens, tokensSelector, WalletToken } from '@store/wallet'
import { tailwind } from '@tailwind'
import BigNumber from 'bignumber.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { BalanceParamList } from './BalancesNavigator'
import { Announcements } from '@screens/AppNavigator/screens/Balances/components/Announcements'
import { DFIBalanceCard } from '@screens/AppNavigator/screens/Balances/components/DFIBalanceCard'
import { translate } from '@translations'
import { BalanceControlCard } from '@screens/AppNavigator/screens/Balances/components/BalanceControlCard'
import { EmptyBalances } from '@screens/AppNavigator/screens/Balances/components/EmptyBalances'
import { RootState } from '@store'
import { useTokenPrice } from './hooks/TokenPrice'
import { TokenNameText } from '@screens/AppNavigator/screens/Balances/components/TokenNameText'
import { TokenAmountText } from '@screens/AppNavigator/screens/Balances/components/TokenAmountText'
import { TotalPortfolio } from './components/TotalPortfolio'
import { SkeletonLoader, SkeletonLoaderScreen } from '@components/SkeletonLoader'
import { AddressSelectionButton } from './components/AddressSelectionButton'
import { BottomSheetWebWithNav, BottomSheetWithNav } from '@components/BottomSheetWithNav'
import { BottomSheetModalMethods } from '@gorhom/bottom-sheet/lib/typescript/types'
import { BottomSheetAddressDetail } from './components/BottomSheetAddressDetail'

type Props = StackScreenProps<BalanceParamList, 'BalancesScreen'>

export interface BalanceRowToken extends WalletToken {
  usdAmount: BigNumber
}

export function BalancesScreen ({ navigation }: Props): JSX.Element {
  const height = useBottomTabBarHeight()
  const client = useWhaleApiClient()
  const { address } = useWalletContext()
  const { wallets } = useWalletPersistenceContext()
  const {
    isBalancesDisplayed,
    toggleDisplayBalances: onToggleDisplayBalances
  } = useDisplayBalancesContext()
  const blockCount = useSelector((state: RootState) => state.block.count)

  const dispatch = useDispatch()
  const { getTokenPrice } = useTokenPrice()
  const [refreshing, setRefreshing] = useState(false)

  // Bottom sheet
  const bottomSheetRef = useRef<BottomSheetModalMethods>(null)
  const containerRef = useRef(null)
  const [isModalDisplayed, setIsModalDisplayed] = useState(false)
  const expandModal = useCallback(() => {
    if (Platform.OS === 'web') {
      setIsModalDisplayed(true)
    } else {
      bottomSheetRef.current?.present()
    }
  }, [])
  const dismissModal = useCallback(() => {
    if (Platform.OS === 'web') {
      setIsModalDisplayed(false)
    } else {
      bottomSheetRef.current?.close()
    }
  }, [])
  const bottomSheetScreen = useMemo(() => {
    return [
    {
      stackScreenName: 'AddressDetail',
      component: BottomSheetAddressDetail({
        address: address,
        addressLabel: 'Test label',
        onReceiveButtonPress: () => { },
        onCloseButtonPress: () => dismissModal()
      }),
      option: {
        header: () => null
      }
    }
  ]
}, [address])

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          testID='header_settings'
        >
          <ThemedIcon
            iconType='MaterialIcons'
            name='settings'
            size={28}
            style={tailwind('ml-2')}
            light={tailwind('text-primary-500')}
            dark={tailwind('text-darkprimary-500')}
          />
        </TouchableOpacity>
      ),
      headerRight: (): JSX.Element => (
        <AddressSelectionButton address={address} onPress={expandModal} />
      )
    })
  }, [navigation, address])

  useEffect(() => {
    dispatch(ocean.actions.setHeight(height))
  }, [height, wallets])

  useEffect(() => {
    dispatch(fetchTokens({
      client,
      address
    }))
  }, [address, blockCount])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    dispatch(fetchTokens({
      client,
      address
    }))
    setRefreshing(false)
  }, [address, client, dispatch])

  const tokens = useSelector((state: RootState) => tokensSelector(state.wallet))
  const {
    totalUSDValue,
    dstTokens
  } = useMemo(() => {
    return tokens.reduce(
      ({
        totalUSDValue,
        dstTokens
      }: { totalUSDValue: BigNumber, dstTokens: BalanceRowToken[] },
        token
      ) => {
        const usdAmount = getTokenPrice(token.symbol, new BigNumber(token.amount), token.isLPS)

        if (token.symbol === 'DFI') {
          return {
            // `token.id === '0_unified'` to avoid repeated DFI price to get added in totalUSDValue
            totalUSDValue: token.id === '0_unified'
              ? totalUSDValue
              : totalUSDValue.plus(usdAmount.isNaN() ? 0 : usdAmount),
            dstTokens
          }
        }
        return {
          totalUSDValue: totalUSDValue.plus(usdAmount.isNaN() ? 0 : usdAmount),
          dstTokens: [...dstTokens, {
            ...token,
            usdAmount
          }]
        }
      }, {
      totalUSDValue: new BigNumber(0),
      dstTokens: []
    })
  }, [getTokenPrice, tokens])

  return (
    <View ref={containerRef}>
      <ThemedScrollView
        contentContainerStyle={tailwind('pb-8')} testID='balances_list'
        refreshControl={
          <RefreshControl
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
        }
      >
        <Announcements />
        <BalanceControlCard />
        <TotalPortfolio
          totalUSDValue={totalUSDValue}
          onToggleDisplayBalances={onToggleDisplayBalances}
          isBalancesDisplayed={isBalancesDisplayed}
        />
        <ThemedSectionTitle text={translate('screens/BalancesScreen', 'YOUR ASSETS')} style={tailwind('px-4 pt-2 pb-2 text-xs font-medium')} />
        <DFIBalanceCard />
        <BalanceList dstTokens={dstTokens} navigation={navigation} />
        {Platform.OS === 'web'
          ? (
            <BottomSheetWebWithNav
              modalRef={containerRef}
              screenList={bottomSheetScreen}
              isModalDisplayed={isModalDisplayed}
            />
          )
: (
  <BottomSheetWithNav
    modalRef={bottomSheetRef}
    screenList={bottomSheetScreen}
  />
          )}
      </ThemedScrollView>
    </View>
  )
}

function BalanceList ({
  dstTokens,
  navigation
}: { dstTokens: BalanceRowToken[], navigation: StackNavigationProp<BalanceParamList> }): JSX.Element {
  const { hasFetchedToken } = useSelector((state: RootState) => (state.wallet))

  if (!hasFetchedToken) {
    return (
      <View style={tailwind('px-4 py-1.5 -mb-3')}>
        <SkeletonLoader row={4} screen={SkeletonLoaderScreen.Balance} />
      </View>
    )
  }

  return (
    <>
      {
        dstTokens.length === 0
          ? (
            <EmptyBalances />
          )
          : (
            <View testID='card_balance_row_container'>
              {dstTokens.sort((a, b) => new BigNumber(b.usdAmount).minus(new BigNumber(a.usdAmount)).toNumber()).map((item) => (
                <View key={item.symbol} style={tailwind('p-4 pt-1.5 pb-1.5')}>
                  <BalanceItemRow
                    onPress={() => navigation.navigate({
                      name: 'TokenDetail',
                      params: { token: item },
                      merge: true
                    })}
                    token={item}
                  />
                </View>
              ))}
            </View>
          )
      }
    </>
  )
}

function BalanceItemRow ({
  token,
  onPress
}: { token: BalanceRowToken, onPress: () => void }): JSX.Element {
  const Icon = getNativeIcon(token.displaySymbol)
  const testID = `balances_row_${token.id}`
  const { isBalancesDisplayed } = useDisplayBalancesContext()
  return (
    <ThemedTouchableOpacity
      dark={tailwind('bg-gray-800')}
      light={tailwind('bg-white')}
      onPress={onPress}
      style={tailwind('p-4 rounded-lg flex-row justify-between items-center')}
      testID={testID}
    >
      <View style={tailwind('flex-row items-center flex-grow')}>
        <Icon testID={`${testID}_icon`} />
        <TokenNameText displaySymbol={token.displaySymbol} name={token.name} testID={testID} />
        <TokenAmountText
          tokenAmount={token.amount} usdAmount={token.usdAmount} testID={testID}
          isBalancesDisplayed={isBalancesDisplayed}
        />
      </View>
    </ThemedTouchableOpacity>
  )
}
