'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    Button as AriaButton,
    Calendar,
    CalendarCell,
    CalendarGrid,
    CalendarGridBody,
    CalendarGridHeader,
    CalendarHeaderCell,
    DateInput,
    DateSegment,
    Heading,
    Label,
    TimeField,
} from 'react-aria-components';
import { CalendarDate, getLocalTimeZone, Time, today } from '@internationalized/date';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { BottomSheet } from '../BottomSheet';
import styles from './DateTimePickerSheet.module.css';

export interface DateTimePickerPreset {
    label: string;
    getValue: () => Date;
}

export interface DateTimePickerSheetProps {
    open: boolean;
    title: string;
    closeLabel: string;
    confirmLabel: string;
    clearLabel: string;
    dateLabel: string;
    timeLabel: string;
    valueIso: string | null;
    presets?: readonly DateTimePickerPreset[];
    onChange: (valueIso: string | null) => void;
    onClose: () => void;
}

export default function DateTimePickerSheet({
    open,
    title,
    closeLabel,
    confirmLabel,
    clearLabel,
    dateLabel,
    timeLabel,
    valueIso,
    presets = [],
    onChange,
    onClose,
}: DateTimePickerSheetProps) {
    const initialDate = useMemo(() => parseIsoOrDefault(valueIso), [valueIso]);
    const [selectedDate, setSelectedDate] = useState<CalendarDate>(() => toCalendarDate(initialDate));
    const [selectedTime, setSelectedTime] = useState<Time>(() => toTime(initialDate));
    const minDate = today(getLocalTimeZone());

    useEffect(() => {
        if (!open) return;
        const nextDate = parseIsoOrDefault(valueIso);
        setSelectedDate(toCalendarDate(nextDate));
        setSelectedTime(toTime(nextDate));
    }, [open, valueIso]);

    const footer = (
        <>
            <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                    onChange(null);
                    onClose();
                }}
            >
                {clearLabel}
            </button>
            <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                    onChange(toIsoString(selectedDate, selectedTime));
                    onClose();
                }}
            >
                {confirmLabel}
            </button>
        </>
    );

    return (
        <BottomSheet open={open} title={title} closeLabel={closeLabel} footer={footer} onClose={onClose}>
            <div className={styles.root}>
                {presets.length > 0 && (
                    <div className={styles.presets} aria-label={title}>
                        {presets.map((preset) => (
                            <button
                                key={preset.label}
                                type="button"
                                className={styles.presetButton}
                                onClick={() => {
                                    const nextValue = preset.getValue();
                                    setSelectedDate(toCalendarDate(nextValue));
                                    setSelectedTime(toTime(nextValue));
                                }}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                )}
                <span className={styles.dateLabel}>{dateLabel}</span>
                <Calendar
                    className={styles.calendar}
                    value={selectedDate}
                    minValue={minDate}
                    onChange={setSelectedDate}
                >
                    <header className={styles.calendarHeader}>
                        <AriaButton className={styles.navButton} slot="previous">
                            <ChevronLeft size={16} />
                        </AriaButton>
                        <Heading className={styles.calendarHeading} />
                        <AriaButton className={styles.navButton} slot="next">
                            <ChevronRight size={16} />
                        </AriaButton>
                    </header>
                    <CalendarGrid className={styles.calendarGrid}>
                        <CalendarGridHeader>
                            {(day) => (
                                <CalendarHeaderCell className={styles.headerCell}>
                                    {day}
                                </CalendarHeaderCell>
                            )}
                        </CalendarGridHeader>
                        <CalendarGridBody>
                            {(date) => (
                                <CalendarCell className={styles.calendarCell} date={date} />
                            )}
                        </CalendarGridBody>
                    </CalendarGrid>
                </Calendar>
                <TimeField
                    className={styles.timeField}
                    value={selectedTime}
                    granularity="minute"
                    hourCycle={24}
                    onChange={(nextTime) => {
                        if (nextTime) setSelectedTime(nextTime);
                    }}
                >
                    <Label className={styles.timeLabel}>{timeLabel}</Label>
                    <DateInput className={styles.timeInput} aria-label={timeLabel}>
                        {(segment) => (
                            <DateSegment className={styles.timeSegment} segment={segment} />
                        )}
                    </DateInput>
                </TimeField>
            </div>
        </BottomSheet>
    );
}

export function formatDateTimeSummary(valueIso: string | null, emptyLabel: string): string {
    if (!valueIso) return emptyLabel;
    const date = new Date(valueIso);
    if (Number.isNaN(date.getTime())) return emptyLabel;
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function parseIsoOrDefault(valueIso: string | null): Date {
    if (valueIso) {
        const parsed = new Date(valueIso);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const date = new Date();
    date.setHours(23, 59, 0, 0);
    return date;
}

function toCalendarDate(value: Date): CalendarDate {
    return new CalendarDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

function toTime(value: Date): Time {
    return new Time(value.getHours(), value.getMinutes());
}

function toIsoString(date: CalendarDate, time: Time): string {
    return new Date(date.year, date.month - 1, date.day, time.hour, time.minute, 0, 0).toISOString();
}
