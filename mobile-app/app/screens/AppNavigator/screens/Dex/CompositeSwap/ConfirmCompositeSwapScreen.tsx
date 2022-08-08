import { Dispatch, useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { tailwind } from '@tailwind'
import { StackScreenProps } from '@react-navigation/stack'
import { NavigationProp, useNavigation } from '@react-navigation/native'
import BigNumber from 'bignumber.js'
import { RootState } from '@store'
import { firstTransactionSelector, hasTxQueued as hasBroadcastQueued } from '@store/ocean'
import { translate } from '@translations'
import { hasTxQueued, transactionQueue } from '@store/transaction_queue'
import { CompositeSwap, CTransactionSegWit, SetFutureSwap } from '@defichain/jellyfish-transaction'
import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs'
import { WhaleWalletAccount } from '@defichain/whale-api-wallet'
import { onTransactionBroadcast } from '@api/transaction/transaction_commands'
import { NativeLoggingProps, useLogger } from '@shared-contexts/NativeLoggingProvider'
import { ThemedIcon, ThemedScrollView, ThemedSectionTitle, ThemedView } from '@components/themed'
import { TextRow } from '@components/TextRow'
import { NumberRow } from '@components/NumberRow'
import { InfoRow, InfoType } from '@components/InfoRow'
import { TransactionResultsRow } from '@components/TransactionResultsRow'
import { SubmitButtonGroup } from '@components/SubmitButtonGroup'
import { SummaryTitle } from '@components/SummaryTitle'
import { getNativeIcon } from '@components/icons/assets'
import { ConversionTag } from '@components/ConversionTag'
import { View } from '@components'
import { InfoText } from '@components/InfoText'
import { DexParamList } from '../DexNavigator'
import { OwnedTokenState, TokenState } from './CompositeSwapScreen'
import { WalletAddressRow } from '@components/WalletAddressRow'
import { PricesSection } from '@components/PricesSection'
import { useAppDispatch } from '@hooks/useAppDispatch'
import { useTokenPrice } from '@screens/AppNavigator/screens/Portfolio/hooks/TokenPrice'

type Props = StackScreenProps<DexParamList, 'ConfirmCompositeSwapScreen'>
export interface CompositeSwapForm {
  tokenFrom: OwnedTokenState
  tokenTo: TokenState & { amount?: string }
  amountFrom: BigNumber
  amountTo: BigNumber
}

export function ConfirmCompositeSwapScreen ({ route }: Props): JSX.Element {
  const {
    conversion,
    fee,
    pairs,
    priceRates,
    slippage,
    tokenA,
    tokenB,
    swap,
    futureSwap,
    estimatedAmount
  } = route.params
  const navigation = useNavigation<NavigationProp<DexParamList>>()
  const dispatch = useAppDispatch()
  const logger = useLogger()
  const { getTokenPrice } = useTokenPrice()
  const hasPendingJob = useSelector((state: RootState) => hasTxQueued(state.transactionQueue))
  const hasPendingBroadcastJob = useSelector((state: RootState) => hasBroadcastQueued(state.ocean))
  const currentBroadcastJob = useSelector((state: RootState) => firstTransactionSelector(state.ocean))
  const blockCount = useSelector((state: RootState) => state.block.count ?? 0)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isOnPage, setIsOnPage] = useState(true)
  const isFutureSwap = futureSwap !== undefined

  const TokenAIcon = getNativeIcon(tokenA.displaySymbol)
  const TokenBIcon = getNativeIcon(tokenB.displaySymbol)

  useEffect(() => {
    setIsOnPage(true)
    return () => {
      setIsOnPage(false)
    }
  }, [])

  async function onSubmit (): Promise<void> {
    if (hasPendingJob || hasPendingBroadcastJob) {
      return
    }

    setIsSubmitting(true)
    if (futureSwap !== undefined) {
      const futureSwapForm: FutureSwapForm = {
        fromTokenId: Number(swap.tokenFrom.id),
        toTokenId: Number(swap.tokenTo.id),
        amount: new BigNumber(swap.amountFrom),
        isSourceLoanToken: futureSwap.isSourceLoanToken,
        fromTokenDisplaySymbol: swap.tokenFrom.displaySymbol,
        toTokenDisplaySymbol: swap.tokenTo.displaySymbol,
        oraclePriceText: futureSwap.oraclePriceText,
        executionBlock: futureSwap.executionBlock
      }
      await constructSignedFutureSwapAndSend(futureSwapForm, dispatch, () => {
        onTransactionBroadcast(isOnPage, navigation.dispatch)
      }, logger)
    } else {
      await constructSignedSwapAndSend(swap, pairs, slippage, dispatch, () => {
        onTransactionBroadcast(isOnPage, navigation.dispatch)
      }, logger)
    }
    setIsSubmitting(false)
  }

  function getSubmitLabel (): string {
    if (!hasPendingBroadcastJob && !hasPendingJob) {
      return 'CONFIRM SWAP'
    }
    if (hasPendingBroadcastJob && currentBroadcastJob !== undefined && currentBroadcastJob.submitButtonLabel !== undefined) {
      return currentBroadcastJob.submitButtonLabel
    }
    return 'SWAPPING'
  }

  function onCancel (): void {
    if (!isSubmitting) {
      navigation.navigate({
        name: 'CompositeSwap',
        params: {},
        merge: true
      })
    }
  }

  function getTransactionType (): string {
    if (isFutureSwap) {
      return translate('screens/ConfirmCompositeSwapScreen', 'Future swap')
    } else if (conversion?.isConversionRequired === true) {
      return translate('screens/ConfirmCompositeSwapScreen', 'Convert & swap')
    } else {
      return translate('screens/ConfirmCompositeSwapScreen', 'Swap')
    }
  }

  return (
    <ThemedScrollView style={tailwind('pb-4')}>
      <ThemedView
        dark={tailwind('bg-gray-800 border-b border-gray-700')}
        light={tailwind('bg-white border-b border-gray-300')}
        style={tailwind('flex-col px-4 py-8')}
      >
        <SummaryTitle
          amount={swap.amountFrom}
          suffixType='component'
          testID='text_swap_amount'
          title={translate('screens/ConfirmCompositeSwapScreen', 'You are swapping')}
        >
          <TokenAIcon height={24} width={24} style={tailwind('ml-1')} />
          <ThemedIcon iconType='MaterialIcons' name='arrow-right-alt' size={24} style={tailwind('px-1')} />
          <TokenBIcon height={24} width={24} />
        </SummaryTitle>
        {conversion?.isConversionRequired === true && <ConversionTag />}
      </ThemedView>

      <ThemedSectionTitle
        testID='title_tx_detail'
        text={translate('screens/ConfirmCompositeSwapScreen', 'TRANSACTION DETAILS')}
      />
      <TextRow
        lhs={translate('screens/ConfirmCompositeSwapScreen', 'Transaction type')}
        rhs={{
          value: getTransactionType(),
          testID: 'confirm_text_transaction_type'
        }}
        textStyle={tailwind('text-sm font-normal')}
      />
      <WalletAddressRow />

      {futureSwap !== undefined
        ? (
          <>
            <TextRow
              lhs={translate('screens/ConfirmCompositeSwapScreen', 'Transaction date')}
              rhs={{
                value: futureSwap.transactionDate,
                testID: 'confirm_text_transaction_date'
              }}
              textStyle={tailwind('text-sm font-normal')}
            />
            <NumberRow
              lhs={translate('screens/ConfirmCompositeSwapScreen', 'Settlement block')}
              rhs={{
                testID: 'confirm_execution_block',
                value: futureSwap.executionBlock
              }}
            />
            <TextRow
              lhs={translate('screens/ConfirmCompositeSwapScreen', 'Estimated to receive')}
              rhs={{
                value: translate('screens/CompositeSwapScreen', 'Oracle price {{percentageChange}}', {
                  percentageChange: futureSwap.oraclePriceText
                }),
                testID: 'confirm_estimated_to_receive'
              }}
              textStyle={tailwind('text-sm font-normal')}
            />
          </>
        )
        : (
          <NumberRow
            lhs={translate('screens/ConfirmCompositeSwapScreen', 'Estimated to receive')}
            rhs={{
              testID: 'confirm_estimated_to_receive',
              value: swap.amountTo.toFixed(8),
              suffixType: 'text',
              suffix: swap.tokenTo.displaySymbol
            }}
            rhsUsdAmount={getTokenPrice(tokenB.symbol, new BigNumber(estimatedAmount), false)}
          />
        )}
      <InfoRow
        type={InfoType.EstimatedFee}
        value={fee.toFixed(8)}
        testID='confirm_text_fee'
        suffix='DFI'
      />
      {!isFutureSwap &&
        (
          <>
            <NumberRow
              lhs={translate('screens/ConfirmCompositeSwapScreen', 'Slippage tolerance')}
              rhs={{
                value: new BigNumber(slippage).times(100).toFixed(),
                suffix: '%',
                testID: 'slippage_fee',
                suffixType: 'text'
              }}
            />
            <PricesSection
              testID='confirm_pricerate_value'
              priceRates={priceRates}
              sectionTitle='PRICES'
            />
          </>
        )}
      {futureSwap !== undefined
        ? (
          <>
            <TransactionResultsRow
              tokens={[
                {
                  symbol: tokenA.displaySymbol,
                  value: BigNumber.max(new BigNumber(tokenA.amount).minus(swap.amountFrom), 0).toFixed(8),
                  suffix: tokenA.displaySymbol
                }
              ]}
            />
            <TextRow
              lhs={translate('screens/ConfirmCompositeSwapScreen', 'Resulting {{token}}', { token: tokenB.displaySymbol })}
              rhs={{
                value: translate('screens/ConfirmCompositeSwapScreen', 'Oracle price {{percentageChange}}', {
                  percentageChange: futureSwap.oraclePriceText
                }),
                testID: `resulting_${tokenB.displaySymbol}`
              }}
              textStyle={tailwind('text-sm font-normal')}
            />
          </>
        )
        : (
          <TransactionResultsRow
            tokens={[
              {
                symbol: tokenA.displaySymbol,
                value: BigNumber.max(
                  new BigNumber(tokenA.amount)
                    .minus(swap.amountFrom)
                    .minus(tokenA.displaySymbol === 'DFI' ? fee : 0)
                , 0).toFixed(8),
                suffix: tokenA.displaySymbol
              },
              {
                symbol: tokenB.displaySymbol,
                value: BigNumber.max(
                  new BigNumber(tokenB?.amount === '' || tokenB?.amount === undefined ? 0 : tokenB?.amount)
                    .plus(swap.amountTo)
                    .minus(tokenB.displaySymbol === 'DFI' ? fee : 0)
                , 0).toFixed(8),
                suffix: tokenB.displaySymbol
              }
            ]}
          />
        )}
      {conversion?.isConversionRequired === true && (
        <View style={tailwind('px-4 pt-2 pb-1 mt-2')}>
          <InfoText
            type='warning'
            testID='conversion_warning_info_text'
            text={translate('components/ConversionInfoText', 'Please wait as we convert tokens for your transaction. Conversions are irreversible.')}
          />
        </View>
      )}
      <SubmitButtonGroup
        isDisabled={isSubmitting || hasPendingJob || hasPendingBroadcastJob || (futureSwap !== undefined && blockCount >= futureSwap.executionBlock)}
        label={translate('screens/ConfirmCompositeSwapScreen', 'CONFIRM SWAP')}
        isProcessing={isSubmitting || hasPendingJob || hasPendingBroadcastJob}
        processingLabel={translate('screens/ConfirmCompositeSwapScreen', getSubmitLabel())}
        onCancel={onCancel}
        onSubmit={onSubmit}
        displayCancelBtn
        title='swap'
      />
    </ThemedScrollView>
  )
}

async function constructSignedSwapAndSend (
  cSwapForm: CompositeSwapForm,
  pairs: PoolPairData[],
  slippage: BigNumber,
  dispatch: Dispatch<any>,
  onBroadcast: () => void,
  logger: NativeLoggingProps
): Promise<void> {
  try {
    const maxPrice = cSwapForm.amountFrom.div(cSwapForm.amountTo).times(slippage.plus(1)).decimalPlaces(8)
    const signer = async (account: WhaleWalletAccount): Promise<CTransactionSegWit> => {
      const builder = account.withTransactionBuilder()
      const script = await account.getScript()
      const swap: CompositeSwap = {
        poolSwap: {
          fromScript: script,
          toScript: script,
          fromTokenId: Number(cSwapForm.tokenFrom.id === '0_unified' ? '0' : cSwapForm.tokenFrom.id),
          toTokenId: Number(cSwapForm.tokenTo.id === '0_unified' ? '0' : cSwapForm.tokenTo.id),
          fromAmount: cSwapForm.amountFrom,
          maxPrice
        },
        pools: pairs.map(pair => ({ id: Number(pair.id) }))
      }
      const dfTx = await builder.dex.compositeSwap(swap, script)

      return new CTransactionSegWit(dfTx)
    }

    dispatch(transactionQueue.actions.push({
      sign: signer,
      title: translate('screens/ConfirmCompositeSwapScreen', 'Swapping Token'),
      description: translate('screens/ConfirmCompositeSwapScreen', 'Swapping {{amountA}} {{symbolA}} to {{amountB}} {{symbolB}}', {
        amountA: cSwapForm.amountFrom.toFixed(8),
        symbolA: cSwapForm.tokenFrom.displaySymbol,
        amountB: cSwapForm.amountTo.toFixed(8),
        symbolB: cSwapForm.tokenTo.displaySymbol
      }),
      drawerMessages: {
        preparing: translate('screens/OceanInterface', 'Preparing to swap tokens…'),
        waiting: translate('screens/OceanInterface', 'Swapping tokens…'),
        complete: translate('screens/OceanInterface', 'Tokens swapped')
      },
      onBroadcast
    }))
  } catch (e) {
    logger.error(e)
  }
}

interface FutureSwapForm {
  fromTokenId: number
  amount: BigNumber
  toTokenId: number
  isSourceLoanToken: boolean
  fromTokenDisplaySymbol: string
  toTokenDisplaySymbol: string
  oraclePriceText: string
  executionBlock: number
}

async function constructSignedFutureSwapAndSend (
  futureSwap: FutureSwapForm,
  dispatch: Dispatch<any>,
  onBroadcast: () => void,
  logger: NativeLoggingProps
): Promise<void> {
  try {
    const signer = async (account: WhaleWalletAccount): Promise<CTransactionSegWit> => {
      const builder = account.withTransactionBuilder()
      const script = await account.getScript()
      const swap: SetFutureSwap = {
        owner: script,
        source: {
          token: futureSwap.fromTokenId,
          amount: futureSwap.amount
        },
        destination: futureSwap.isSourceLoanToken ? 0 : futureSwap.toTokenId,
        withdraw: false
      }
      const dfTx = await builder.account.futureSwap(swap, script)

      return new CTransactionSegWit(dfTx)
    }

    dispatch(transactionQueue.actions.push({
      sign: signer,
      title: translate('screens/ConfirmCompositeSwapScreen', 'Future swapping Token'),
      description: translate('screens/ConfirmCompositeSwapScreen', 'Swap on future block {{amountA}} {{fromTokenDisplaySymbol}} to {{toTokenDisplaySymbol}} on oracle price {{percentageChange}}', {
        amountA: futureSwap.amount.toFixed(8),
        fromTokenDisplaySymbol: futureSwap.fromTokenDisplaySymbol,
        toTokenDisplaySymbol: futureSwap.toTokenDisplaySymbol,
        percentageChange: futureSwap.oraclePriceText
      }),
      drawerMessages: {
        preparing: translate('screens/OceanInterface', 'Preparing your transaction…'),
        waiting: translate('screens/OceanInterface', 'Processing future swap transaction…'),
        complete: translate('screens/OceanInterface', 'Future Swap confirmed and will be executed at block #{{block}}', { block: futureSwap.executionBlock })
      },
      onBroadcast
    }))
  } catch (e) {
    logger.error(e)
  }
}
