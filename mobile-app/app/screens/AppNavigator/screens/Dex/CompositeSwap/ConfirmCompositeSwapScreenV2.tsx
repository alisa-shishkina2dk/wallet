import { Dispatch, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { tailwind } from "@tailwind";
import { StackScreenProps } from "@react-navigation/stack";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import BigNumber from "bignumber.js";
import { RootState } from "@store";
import {
  firstTransactionSelector,
  hasTxQueued as hasBroadcastQueued,
} from "@store/ocean";
import { translate } from "@translations";
import { hasTxQueued, transactionQueue } from "@store/transaction_queue";
import {
  CompositeSwap,
  CTransactionSegWit,
  SetFutureSwap,
} from "@defichain/jellyfish-transaction";
import { PoolPairData } from "@defichain/whale-api-client/dist/api/poolpairs";
import { WhaleWalletAccount } from "@defichain/whale-api-wallet";
import { onTransactionBroadcast } from "@api/transaction/transaction_commands";
import {
  NativeLoggingProps,
  useLogger,
} from "@shared-contexts/NativeLoggingProvider";
import {
  ThemedActivityIndicatorV2,
  ThemedIcon,
  ThemedScrollViewV2,
  ThemedTextV2,
  ThemedTouchableOpacityV2,
  ThemedViewV2,
} from "@components/themed";
import { View } from "@components";
import { useAppDispatch } from "@hooks/useAppDispatch";
import { useTokenPrice } from "@screens/AppNavigator/screens/Portfolio/hooks/TokenPrice";
import { useWalletContext } from "@shared-contexts/WalletContext";
import { useAddressLabel } from "@hooks/useAddressLabel";
import { ConfirmSummaryTitleV2 } from "@components/ConfirmSummaryTitleV2";
import { NumberRowV2 } from "@components/NumberRowV2";
import { SubmitButtonGroupV2 } from "@components/SubmitButtonGroupV2";
import { ConfirmPricesSectionV2 } from "@components/ConfirmPricesSectionV2";
import { useBottomSheet } from "@hooks/useBottomSheet";
import { useThemeContext } from "@shared-contexts/ThemeProvider";
import { Platform } from "react-native";
import {
  BottomSheetWebWithNavV2,
  BottomSheetWithNavV2,
} from "@components/BottomSheetWithNavV2";
import { TextRowV2 } from "@components/TextRowV2";
import { useTokenBestPath } from "../../Portfolio/hooks/TokenBestPath";
import { DexParamList } from "../DexNavigator";
import { OwnedTokenState, TokenState } from "./CompositeSwapScreenV2";
import { ViewFeeDetails } from "./components/ViewFeeDetails";
import { FeeBreakdown } from "./components/FeeBreakdown";

type Props = StackScreenProps<DexParamList, "ConfirmCompositeSwapScreen">;
export interface CompositeSwapForm {
  tokenFrom: OwnedTokenState;
  tokenTo: TokenState & { amount?: string };
  amountFrom: BigNumber;
  amountTo: BigNumber;
}

export function ConfirmCompositeSwapScreenV2({ route }: Props): JSX.Element {
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
    estimatedAmount,
  } = route.params;
  const navigation = useNavigation<NavigationProp<DexParamList>>();
  const dispatch = useAppDispatch();
  const logger = useLogger();
  const { getTokenPrice } = useTokenPrice();
  const { getBestPath } = useTokenBestPath();
  const hasPendingJob = useSelector((state: RootState) =>
    hasTxQueued(state.transactionQueue)
  );
  const hasPendingBroadcastJob = useSelector((state: RootState) =>
    hasBroadcastQueued(state.ocean)
  );
  const blockCount = useSelector((state: RootState) => state.block.count ?? 0);
  const [totalFees, setTotalFees] = useState(new BigNumber(0));
  // const lmTokenAmount = percentage.times(pair.totalLiquidity.token)
  const currentBroadcastJob = useSelector((state: RootState) =>
    firstTransactionSelector(state.ocean)
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOnPage, setIsOnPage] = useState(true);
  const isFutureSwap = futureSwap !== undefined;

  const { address } = useWalletContext();
  const addressLabel = useAddressLabel(address);

  const { isLight } = useThemeContext();
  const modalSortingSnapPoints = { ios: ["60%"], android: ["60%"] };

  const {
    bottomSheetRef,
    containerRef,
    expandModal,
    dismissModal,
    isModalDisplayed,
  } = useBottomSheet();

  // TODO: refactor into common component - used by Add/Remove Liq as well
  const BottomSheetHeader = {
    headerStatusBarHeight: 2,
    headerTitle: "",
    headerBackTitleVisible: false,
    headerStyle: tailwind("rounded-t-xl-v2 border-b-0", {
      "bg-mono-light-v2-100": isLight,
      "bg-mono-dark-v2-100": !isLight,
    }),
    headerRight: (): JSX.Element => {
      return (
        <ThemedTouchableOpacityV2
          style={tailwind("mr-5 mt-4 -mb-4")}
          onPress={dismissModal}
          testID="close_bottom_sheet_button"
        >
          <ThemedIcon iconType="Feather" name="x-circle" size={22} />
        </ThemedTouchableOpacityV2>
      );
    },
  };

  const getTotalFees = async (): Promise<void> => {
    const { estimatedReturn, estimatedReturnLessDexFees } = await getBestPath(
      tokenA.id,
      tokenB.id
    );
    setTotalFees(
      new BigNumber(estimatedReturn).minus(
        new BigNumber(estimatedReturnLessDexFees)
      )
    );
  };

  useEffect(() => {
    getTotalFees();
  }, []);

  const ViewFeeBreakdownContents = useMemo(() => {
    return [
      {
        stackScreenName: "ViewFeeBreakdown",
        component: ViewFeeDetails({}),
        option: BottomSheetHeader,
      },
    ];
  }, [isLight]);

  useEffect(() => {
    setIsOnPage(true);
    return () => {
      setIsOnPage(false);
    };
  }, []);

  async function onSubmit(): Promise<void> {
    if (hasPendingJob || hasPendingBroadcastJob) {
      return;
    }

    setIsSubmitting(true);
    if (futureSwap !== undefined) {
      const futureSwapForm: FutureSwapForm = {
        fromTokenId: Number(swap.tokenFrom.id),
        toTokenId: Number(swap.tokenTo.id),
        amount: new BigNumber(swap.amountFrom),
        isSourceLoanToken: futureSwap.isSourceLoanToken,
        fromTokenDisplaySymbol: swap.tokenFrom.displaySymbol,
        toTokenDisplaySymbol: swap.tokenTo.displaySymbol,
        oraclePriceText: futureSwap.oraclePriceText,
        executionBlock: futureSwap.executionBlock,
      };
      await constructSignedFutureSwapAndSend(
        futureSwapForm,
        dispatch,
        () => {
          onTransactionBroadcast(isOnPage, navigation.dispatch);
        },
        logger
      );
    } else {
      await constructSignedSwapAndSend(
        swap,
        pairs,
        slippage,
        dispatch,
        () => {
          onTransactionBroadcast(isOnPage, navigation.dispatch);
        },
        logger
      );
    }
    setIsSubmitting(false);
  }

  function onCancel(): void {
    if (!isSubmitting) {
      navigation.navigate({
        name: "CompositeSwap",
        params: {},
        merge: true,
      });
    }
  }

  return (
    <ThemedScrollViewV2 style={tailwind("py-8 px-5")}>
      <ThemedViewV2 style={tailwind("flex-col pb-4 mb-4")}>
        <ConfirmSummaryTitleV2
          title={translate("screens/ConvertConfirmScreen", "You are swapping")}
          amount={swap.amountFrom}
          testID="text_convert_amount"
          iconA={tokenA.displaySymbol}
          iconB={tokenB.displaySymbol}
          fromAddress={address}
          fromAddressLabel={addressLabel}
          forTokenAmount={estimatedAmount}
        />
      </ThemedViewV2>

      {conversion?.isConversionRequired === true && (
        <ThemedViewV2
          dark={tailwind("border-gray-700")}
          light={tailwind("border-gray-300")}
          style={tailwind("py-5 border-t-0.5")}
        >
          <NumberRowV2
            lhs={{
              value: translate("screens/ConfirmAddLiq", "Amount to convert"),
              testID: "transaction_fee",
              themedProps: {
                light: tailwind("text-mono-light-v2-500"),
                dark: tailwind("text-mono-dark-v2-500"),
              },
            }}
            rhs={{
              value: conversion.conversionAmount.toFixed(8),
              testID: "amount_to_convert",
            }}
          />
          <View
            style={tailwind(
              "flex flex-row text-right items-center justify-end"
            )}
          >
            <ThemedTextV2
              style={tailwind("mr-1.5 font-normal-v2 text-sm")}
              light={tailwind("text-mono-light-v2-700")}
              dark={tailwind("text-mono-dark-v2-700")}
              testID="conversion_status"
            >
              {translate(
                "screens/ConvertConfirmScreen",
                conversion?.isConversionRequired &&
                  conversion?.isConverted !== true
                  ? "Converting"
                  : "Converted"
              )}
            </ThemedTextV2>
            {conversion?.isConversionRequired &&
              conversion?.isConverted !== true && <ThemedActivityIndicatorV2 />}
            {conversion?.isConversionRequired &&
              conversion?.isConverted === true && (
                <ThemedIcon
                  light={tailwind("text-success-600")}
                  dark={tailwind("text-darksuccess-500")}
                  iconType="MaterialIcons"
                  name="check-circle"
                  size={20}
                />
              )}
          </View>
        </ThemedViewV2>
      )}

      {!isFutureSwap && (
        <ThemedViewV2
          dark={tailwind("border-gray-700")}
          light={tailwind("border-gray-300")}
          style={tailwind("py-5 border-t-0.5")}
        >
          <ConfirmPricesSectionV2
            testID="confirm_pricerate_value"
            priceRates={priceRates}
            sectionTitle="PRICES"
          />
          <NumberRowV2
            lhs={{
              value: translate(
                "screens/ConfirmCompositeSwapScreen",
                "Slippage tolerance"
              ),
              testID: "transaction_fee",
              themedProps: {
                light: tailwind("text-mono-light-v2-500"),
                dark: tailwind("text-mono-dark-v2-500"),
              },
            }}
            rhs={{
              value: new BigNumber(slippage).times(100).toFixed(),
              testID: "transaction_fee_amount",
              suffix: "%",
            }}
          />
        </ThemedViewV2>
      )}

      {!isFutureSwap && (
        <ThemedViewV2
          dark={tailwind("border-gray-700")}
          light={tailwind("border-gray-300")}
          style={tailwind("py-5 border-t-0.5")}
        >
          <NumberRowV2
            lhs={{
              value: translate(
                "screens/ConfirmCompositeSwapScreen",
                "Total fees"
              ),
              testID: "transaction_fee",
              themedProps: {
                light: tailwind("text-mono-light-v2-500"),
                dark: tailwind("text-mono-dark-v2-500"),
              },
            }}
            rhs={{
              value: totalFees.toFixed(8),
              testID: "transaction_fee_amount",
              prefix: "$",
            }}
          />
          <View style={tailwind("items-end")}>
            <FeeBreakdown onPress={expandModal} />
          </View>
        </ThemedViewV2>
      )}

      <ThemedViewV2
        dark={tailwind("border-gray-700")}
        light={tailwind("border-gray-300")}
        style={tailwind("border-t-0.5")}
      >
        {futureSwap !== undefined ? (
          <>
            <ThemedViewV2
              dark={tailwind("border-gray-700")}
              light={tailwind("border-gray-300")}
              style={tailwind("py-5 border-b-0.5")}
            >
              <NumberRowV2
                lhs={{
                  value: translate(
                    "screens/ConfirmCompositeSwapScreen",
                    "Transaction fee"
                  ),
                  testID: "settlement_block",
                  themedProps: {
                    light: tailwind("text-mono-light-v2-500"),
                    dark: tailwind("text-mono-dark-v2-500"),
                  },
                }}
                rhs={{
                  value: fee.toFixed(8),
                  testID: "confirm_text_transaction_date",
                  suffix: " DFI",
                }}
              />
            </ThemedViewV2>
            <View style={tailwind("pt-5")}>
              <NumberRowV2
                lhs={{
                  value: translate(
                    "screens/ConfirmCompositeSwapScreen",
                    "Settlement block"
                  ),
                  testID: "settlement_block",
                  themedProps: {
                    light: tailwind("text-mono-light-v2-500"),
                    dark: tailwind("text-mono-dark-v2-500"),
                  },
                }}
                rhs={{
                  value: futureSwap.executionBlock,
                  testID: "confirm_text_transaction_date",
                }}
              />
              <TextRowV2
                lhs={{
                  value: "",
                  testID: "",
                }}
                rhs={{
                  value: futureSwap.transactionDate,
                  testID: "confirm_text_transaction_date",
                }}
              />
            </View>
            <ThemedViewV2
              dark={tailwind("border-gray-700")}
              light={tailwind("border-gray-300")}
              style={tailwind("py-5 border-b-0.5")}
            >
              <TextRowV2
                lhs={{
                  value: translate(
                    "screens/ConfirmCompositeSwapScreen",
                    "To receive (est.)"
                  ),
                  testID: "settlement_block",
                  themedProps: {
                    light: tailwind("text-mono-light-v2-500"),
                    dark: tailwind("text-mono-dark-v2-500"),
                  },
                }}
                rhs={{
                  value: `${tokenB.displaySymbol}`,
                  testID: "confirm_text_transaction_date",
                  themedProps: {
                    light: tailwind("text-mono-light-v2-900"),
                    dark: tailwind("text-mono-dark-v2-900"),
                  },
                }}
              />
              <TextRowV2
                lhs={{
                  value: "",
                  testID: "",
                }}
                rhs={{
                  value: translate(
                    "screens/CompositeSwapScreen",
                    "Oracle price {{percentageChange}}",
                    {
                      percentageChange: futureSwap.oraclePriceText,
                    }
                  ),
                  testID: "confirm_estimated_to_receive",
                }}
              />
            </ThemedViewV2>
          </>
        ) : (
          <ThemedViewV2
            dark={tailwind("border-gray-700")}
            light={tailwind("border-gray-300")}
            style={tailwind("py-5 border-b-0.5")}
          >
            <NumberRowV2
              lhs={{
                value: translate(
                  "screens/ConfirmCompositeSwapScreen",
                  "To receive (incl. of fees"
                ), // estimated return less dex fees
                testID: "estimated_to_receive",
                themedProps: {
                  light: tailwind("text-mono-light-v2-500"),
                  dark: tailwind("text-mono-dark-v2-500"),
                },
              }}
              rhs={{
                testID: "confirm_estimated_to_receive",
                value: swap.amountTo.toFixed(8),
                suffix: ` ${swap.tokenTo.displaySymbol}`,
                usdAmount: getTokenPrice(
                  tokenB.symbol,
                  new BigNumber(estimatedAmount),
                  false
                ),
                themedProps: {
                  style: tailwind("font-semibold-v2"),
                },
              }}
            />
          </ThemedViewV2>
        )}
      </ThemedViewV2>

      <View style={tailwind("py-14 px-3")}>
        <SubmitButtonGroupV2
          isDisabled={
            isSubmitting ||
            hasPendingJob ||
            hasPendingBroadcastJob ||
            (futureSwap !== undefined &&
              blockCount >= futureSwap.executionBlock)
          }
          label={translate("screens/ConfirmCompositeSwapScreen", "Swap")}
          onSubmit={onSubmit}
          onCancel={onCancel}
          displayCancelBtn
          title="swap"
        />
      </View>

      {Platform.OS === "web" ? (
        <BottomSheetWebWithNavV2
          modalRef={containerRef}
          screenList={ViewFeeBreakdownContents}
          isModalDisplayed={isModalDisplayed}
          // eslint-disable-next-line react-native/no-inline-styles
          modalStyle={{
            position: "absolute",
            bottom: "0",
            height: "404px",
            width: "375px",
            zIndex: 50,
            borderTopLeftRadius: 15,
            borderTopRightRadius: 15,
            overflow: "hidden",
          }}
        />
      ) : (
        <BottomSheetWithNavV2
          modalRef={bottomSheetRef}
          screenList={ViewFeeBreakdownContents}
          snapPoints={modalSortingSnapPoints}
        />
      )}
    </ThemedScrollViewV2>
  );
}

async function constructSignedSwapAndSend(
  cSwapForm: CompositeSwapForm,
  pairs: PoolPairData[],
  slippage: BigNumber,
  dispatch: Dispatch<any>,
  onBroadcast: () => void,
  logger: NativeLoggingProps
): Promise<void> {
  try {
    const maxPrice = cSwapForm.amountFrom
      .div(cSwapForm.amountTo)
      .times(slippage.plus(1))
      .decimalPlaces(8);
    const signer = async (
      account: WhaleWalletAccount
    ): Promise<CTransactionSegWit> => {
      const builder = account.withTransactionBuilder();
      const script = await account.getScript();
      const swap: CompositeSwap = {
        poolSwap: {
          fromScript: script,
          toScript: script,
          fromTokenId: Number(
            cSwapForm.tokenFrom.id === "0_unified"
              ? "0"
              : cSwapForm.tokenFrom.id
          ),
          toTokenId: Number(
            cSwapForm.tokenTo.id === "0_unified" ? "0" : cSwapForm.tokenTo.id
          ),
          fromAmount: cSwapForm.amountFrom,
          maxPrice,
        },
        pools: pairs.map((pair) => ({ id: Number(pair.id) })),
      };
      const dfTx = await builder.dex.compositeSwap(swap, script);

      return new CTransactionSegWit(dfTx);
    };

    dispatch(
      transactionQueue.actions.push({
        sign: signer,
        title: translate(
          "screens/ConfirmCompositeSwapScreen",
          "Swapping {{amountA}} {{symbolA}} to {{symbolB}}",
          {
            amountA: cSwapForm.amountFrom.toFixed(8),
            symbolA: cSwapForm.tokenFrom.displaySymbol,
            symbolB: cSwapForm.tokenTo.displaySymbol,
          }
        ),
        drawerMessages: {
          waiting: translate(
            "screens/OceanInterface",
            "Swapping {{amountA}} {{symbolA}} to {{symbolB}}",
            {
              amountA: cSwapForm.amountFrom.toFixed(8),
              symbolA: cSwapForm.tokenFrom.displaySymbol,
              symbolB: cSwapForm.tokenTo.displaySymbol,
            }
          ),
          complete: translate(
            "screens/OceanInterface",
            "Swapped {{amountA}} {{symbolA}} to {{symbolB}}",
            {
              amountA: cSwapForm.amountFrom.toFixed(8),
              symbolA: cSwapForm.tokenFrom.displaySymbol,
              symbolB: cSwapForm.tokenTo.displaySymbol,
            }
          ),
        },
        onBroadcast,
      })
    );
  } catch (e) {
    logger.error(e);
  }
}

interface FutureSwapForm {
  fromTokenId: number;
  amount: BigNumber;
  toTokenId: number;
  isSourceLoanToken: boolean;
  fromTokenDisplaySymbol: string;
  toTokenDisplaySymbol: string;
  oraclePriceText: string;
  executionBlock: number;
}

async function constructSignedFutureSwapAndSend(
  futureSwap: FutureSwapForm,
  dispatch: Dispatch<any>,
  onBroadcast: () => void,
  logger: NativeLoggingProps
): Promise<void> {
  try {
    const signer = async (
      account: WhaleWalletAccount
    ): Promise<CTransactionSegWit> => {
      const builder = account.withTransactionBuilder();
      const script = await account.getScript();
      const swap: SetFutureSwap = {
        owner: script,
        source: {
          token: futureSwap.fromTokenId,
          amount: futureSwap.amount,
        },
        destination: futureSwap.isSourceLoanToken ? 0 : futureSwap.toTokenId,
        withdraw: false,
      };
      const dfTx = await builder.account.futureSwap(swap, script);

      return new CTransactionSegWit(dfTx);
    };

    dispatch(
      transactionQueue.actions.push({
        sign: signer,
        title: translate(
          "screens/ConfirmCompositeSwapScreen",
          "Swapping {{amountA}} {{fromTokenDisplaySymbol}} to {{toTokenDisplaySymbol}} on settlement block {{settlementBlock}}",
          {
            amountA: futureSwap.amount.toFixed(8),
            fromTokenDisplaySymbol: futureSwap.fromTokenDisplaySymbol,
            toTokenDisplaySymbol: futureSwap.toTokenDisplaySymbol,
            settlementBlock: futureSwap.executionBlock,
          }
        ),
        drawerMessages: {
          preparing: translate(
            "screens/OceanInterface",
            "Preparing your transaction…"
          ),
          waiting: translate(
            "screens/OceanInterface",
            "Processing future swap…"
          ),
          complete: translate(
            "screens/OceanInterface",
            "Future Swap confirmed for next settlement block"
          ),
        },
        onBroadcast,
      })
    );
  } catch (e) {
    logger.error(e);
  }
}