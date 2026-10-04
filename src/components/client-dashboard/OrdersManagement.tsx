import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar, Plus, Package, CheckCircle2, Clock, Users, Star, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchBookableCaregivers } from "@/lib/clientCareTeam";

interface CareType {
  id: string;
  care_type_code: string;
  care_types: {
    name: string;
    code: string;
    category: string;
    keywords: string;
    description: string;
    price: number;
    duration_hours: number;
  };
}

interface Order {
  id: string;
  order_number: string;
  start_date: string;
  end_date: string;
  status: string;
  frequency: string;
  created_at: string;
}

interface Caregiver {
  id: string;
  first_name: string;
  last_name: string; // last initial + "." (M-SEC-5: display-safe RPC; no pay rate, no zip list)
  avg_rating?: number | null;
  rating_count?: number;
  caregiver_availability?: {
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_available: boolean;
  }[];
}

interface OrdersManagementProps {
  clientProfile: { id: string; agency_id: string } | null;
  user: any;
  availableCareTypes: CareType[];
  currentOrder: Order | null;
  onRefresh: () => void;
}

interface BookingData {
  primaryService: CareType | null;
  additionalService: CareType | null;
  duration: number;
  day: number | null;
  repeat: 'once' | 'weekly' | 'biweekly' | 'monthly';
  caregiver: Caregiver | null;
  time: string;
  startDate: string;
  rate: number;
}

const getServiceIcon = (category: string) => {
  const iconMap: Record<string, string> = {
    'Activities of Daily Living (ADL)': '🛁',
    'Instrumental Activities of Daily Living (IADL)': '🏠',
    'Health Monitoring & Care': '❤️',
    'Cognitive & Emotional Support': '🧠',
    'Safety & Transportation': '🚗',
    'Specialized Care': '⚕️',
  };
  return iconMap[category] || '💼';
};

const timeSlots = {
  morning: ['6:00', '7:00', '8:00', '9:00', '10:00'],
  afternoon: ['12:00', '1:00', '2:00', '3:00', '4:00'],
  evening: ['6:00', '7:00', '8:00'],
};

export const OrdersManagement = ({ 
  clientProfile, 
  user, 
  availableCareTypes, 
  currentOrder,
  onRefresh 
}: OrdersManagementProps) => {
  const [step, setStep] = useState(1);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [bookingData, setBookingData] = useState<BookingData>({
    primaryService: null,
    additionalService: null,
    duration: 0,
    day: null,
    repeat: 'once',
    caregiver: null,
    time: '',
    startDate: '',
    rate: 35,
  });
  
  const [availableCaregivers, setAvailableCaregivers] = useState<Caregiver[]>([]);
  const [loadingCaregivers, setLoadingCaregivers] = useState(false);
  
  const [allCareTypes, setAllCareTypes] = useState<CareType[]>([]);
  useEffect(() => {
    const fetchCareTypes = async () => {
      const { data, error } = await supabase
        .from('care_types')
        .select('id, code, name, category, description, keywords, price, duration_hours')
        .eq('is_active', true);
      if (!error && data) {
        const mapped: CareType[] = (data as any[]).map((ct: any) => ({
          id: ct.id,
          care_type_code: ct.code,
          care_types: {
            name: ct.name,
            code: ct.code,
            category: ct.category,
            keywords: ct.keywords,
            description: ct.description,
            price: ct.price,
            duration_hours: ct.duration_hours,
          },
        }));
        setAllCareTypes(mapped);
      }
    };
    fetchCareTypes();
  }, []);

  // Fetch all orders
  useEffect(() => {
    const fetchOrders = async () => {
      if (!clientProfile?.id) return;
      
      const { data, error } = await supabase
        .from('client_orders')
        .select('*')
        .eq('client_id', clientProfile.id)
        .in('status', ['active', 'submitted'])
        .order('created_at', { ascending: false });
      
      if (!error && data) {
        setAllOrders(data);
      }
    };
    fetchOrders();
  }, [clientProfile?.id]);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const primaryServices = availableCareTypes.filter(
    s => s.care_types?.category === 'Activities of Daily Living (ADL)' || 
         s.care_types?.category === 'Health Monitoring & Care' ||
         s.care_types?.category === 'Instrumental Activities of Daily Living (IADL)'
  );

  const additionalServices = (
    (availableCareTypes && availableCareTypes.length > 1) ? availableCareTypes : allCareTypes
  ).filter((s) => bookingData.primaryService ? s.care_types.code !== bookingData.primaryService.care_types.code : true);

  const loadAvailableCaregivers = async () => {
    if (!clientProfile || bookingData.day === null) return;

    setLoadingCaregivers(true);
    try {
      // M-SEC-5: get_bookable_caregivers() does the zip/office/availability filtering server-side
      // for the signed-in client and returns display-safe fields only (no rate, no zip list).
      const day = bookingData.day;
      const filteredCaregivers: Caregiver[] = (await fetchBookableCaregivers(day)).map((c) => ({
        id: c.caregiver_id,
        first_name: c.first_name,
        last_name: c.last_initial ? `${c.last_initial}.` : "",
        avg_rating: c.avg_rating,
        rating_count: c.rating_count,
        caregiver_availability: c.day_windows.map((w) => ({ day_of_week: day, start_time: w.start_time, end_time: w.end_time, is_available: true })),
      }));
      const withRatings = filteredCaregivers
        // Unrated caregivers are neutral, not zero: they sort after rated ones
        // but ahead of anyone actually rated below average.
        .sort((a: any, b: any) => {
          if (a.avg_rating == null && b.avg_rating == null) return 0;
          if (a.avg_rating == null) return 1;
          if (b.avg_rating == null) return -1;
          return b.avg_rating - a.avg_rating;
        });

      setAvailableCaregivers(withRatings);

      if (filteredCaregivers.length === 0) {
        toast.info(`No caregivers available on ${dayNames[bookingData.day]}`);
      }
    } catch (error: any) {
      toast.error("Failed to fetch caregivers");
      console.error(error);
    } finally {
      setLoadingCaregivers(false);
    }
  };

  useEffect(() => {
    if (step === 2 && bookingData.day !== null) {
      loadAvailableCaregivers();
    }
  }, [step, bookingData.day]);

  const selectPrimaryService = (service: CareType) => {
    setBookingData(prev => ({ 
      ...prev, 
      primaryService: service, 
      duration: service.care_types.duration_hours || 4,
      rate: service.care_types.price || 35
    }));
  };

  const selectAdditionalService = (service: CareType | null) => {
    if (service) {
      const primaryDuration = bookingData.primaryService?.care_types.duration_hours || 4;
      const additionalDuration = service.care_types.duration_hours || 4;
      const totalDuration = primaryDuration + additionalDuration;
      const totalRate = (bookingData.primaryService?.care_types.price || 35) + (service.care_types.price || 35);
      setBookingData(prev => ({ 
        ...prev, 
        additionalService: service, 
        duration: totalDuration,
        rate: totalRate / 2 // Average rate
      }));
    } else {
      setBookingData(prev => ({ 
        ...prev, 
        additionalService: null, 
        duration: bookingData.primaryService?.care_types.duration_hours || 4,
        rate: bookingData.primaryService?.care_types.price || 35
      }));
    }
  };

  const selectDay = (dayIndex: number) => {
    setBookingData(prev => ({ ...prev, day: dayIndex, caregiver: null, time: '' }));
  };

  const selectTimeSlot = (caregiver: Caregiver, time: string, period: string) => {
    const timeString = `${time} ${period}`;
    setBookingData(prev => ({ ...prev, caregiver, time: timeString }));
  };

  const handleSubmitBooking = async () => {
    if (!clientProfile || !bookingData.primaryService || !bookingData.caregiver || 
        !bookingData.time || bookingData.day === null || !bookingData.startDate) {
      toast.error("Please complete all required fields");
      return;
    }

    setLoading(true);
    try {
      // Use the user-selected start date
      const start = bookingData.startDate;
      
      let end = new Date(start);
      if (bookingData.repeat === 'weekly') {
        end.setMonth(end.getMonth() + 3); // 3 months for weekly
      } else if (bookingData.repeat === 'biweekly') {
        end.setMonth(end.getMonth() + 6); // 6 months for biweekly  
      } else if (bookingData.repeat === 'monthly') {
        end.setMonth(end.getMonth() + 12); // 12 months for monthly
      } else {
        end = new Date(start); // one time only
      }

      const orderNumber = `ORD-${Date.now()}`;
      const { data: newOrder, error: orderError } = await supabase
        .from("client_orders")
        .insert({
          client_id: clientProfile.id,
          agency_id: clientProfile.agency_id,
          order_number: orderNumber,
          start_date: start,
          end_date: end.toISOString().split('T')[0],
          frequency: bookingData.repeat,
          status: "submitted"
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Create shifts
      const shiftsToCreate = [];
      const [timeValue, period] = bookingData.time.split(' ');
      let [hours] = timeValue.split(':').map(Number);
      
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      
      const startTimeHours = hours;
      const endTimeHours = hours + bookingData.duration;
      const startTime = `${String(startTimeHours).padStart(2, '0')}:00`;
      const endTime = `${String(endTimeHours % 24).padStart(2, '0')}:00`;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === bookingData.day) {
          const shiftDate = d.toISOString().split('T')[0];
          shiftsToCreate.push({
            client_id: clientProfile.id,
            agency_id: clientProfile.agency_id,
            order_id: newOrder.id,
            shift_date: shiftDate,
            start_time: startTime,
            end_time: endTime,
            duration_hours: bookingData.duration,
            care_type_code: bookingData.primaryService.care_type_code,
            status: 'open',
            special_notes: bookingData.additionalService
              ? `Includes ${bookingData.additionalService.care_types.name}` 
              : null,
            order_title: bookingData.primaryService.care_types.name
          });
        }
      }

      const { data: createdShifts, error: shiftsError } = await supabase
        .from("shifts")
        .insert(shiftsToCreate)
        .select("id");

      if (shiftsError) throw shiftsError;

      // Clients request a caregiver; only agency staff may create the assignment
      // (server-side eligibility rules). Record the request on the shift instead.
      if (bookingData.caregiver?.id && createdShifts?.length) {
        const requested = [bookingData.caregiver.first_name, bookingData.caregiver.last_name]
          .filter(Boolean)
          .join(" ") || "a specific caregiver";
        const { error: noteError } = await supabase
          .from("shifts")
          .update({ special_instructions: `Client requested ${requested}.` })
          .in("id", createdShifts.map((s: any) => s.id));
        if (noteError) throw noteError;
      }

      toast.success("Care plan submitted successfully!");
      setStep(3);
      onRefresh();
    } catch (error: any) {
      toast.error(error.message || "Failed to submit care plan");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setShowOrderForm(false);
    setStep(1);
    setBookingData({
      primaryService: null,
      additionalService: null,
      duration: 0,
      day: null,
      repeat: 'once',
      caregiver: null,
      time: '',
      startDate: '',
      rate: 35,
    });
    setAvailableCaregivers([]);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      draft: { variant: "outline", label: "Draft" },
      submitted: { variant: "secondary", label: "Submitted" },
      active: { variant: "default", label: "Active" },
      completed: { variant: "secondary", label: "Completed" }
    };
    const config = variants[status] || { variant: "outline", label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Care Plans</h2>
          <p className="text-sm text-muted-foreground">Create and manage your care orders</p>
        </div>
        {!showOrderForm && (
          <Button onClick={() => setShowOrderForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Order
          </Button>
        )}
      </div>

      {/* Order Form */}
      {showOrderForm && (
        <Card className="border-primary/20 shadow-xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Create Care Plan</CardTitle>
                <CardDescription>Step {step} of 3</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Progress Bar */}
            <div className="mb-8">
              <div className="flex items-center justify-center gap-4 mb-4">
                <div className={`flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold transition-all ${
                  step >= 1 ? 'bg-primary text-primary-foreground scale-110' : 'bg-muted text-muted-foreground'
                }`}>
                  1
                </div>
                <div className={`h-1 w-16 transition-all ${step >= 2 ? 'bg-primary' : 'bg-muted'}`} />
                <div className={`flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold transition-all ${
                  step >= 2 ? 'bg-primary text-primary-foreground scale-110' : 'bg-muted text-muted-foreground'
                }`}>
                  2
                </div>
                <div className={`h-1 w-16 transition-all ${step >= 3 ? 'bg-primary' : 'bg-muted'}`} />
                <div className={`flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold transition-all ${
                  step >= 3 ? 'bg-primary text-primary-foreground scale-110' : 'bg-muted text-muted-foreground'
                }`}>
                  3
                </div>
              </div>
            </div>

            {/* Step 1: Select Primary Service */}
            {step === 1 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <h3 className="text-2xl font-bold mb-2">Select Primary Service</h3>
                  <p className="text-sm text-muted-foreground">Choose your main care need</p>
                </div>
                
                <div className="grid gap-3 max-h-[400px] overflow-y-auto">
                  {primaryServices.map((service) => (
                    <Card
                      key={service.id}
                      className={`cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] ${
                        bookingData.primaryService?.id === service.id
                          ? 'border-primary bg-primary/5 ring-2 ring-primary'
                          : 'hover:border-primary/50'
                      }`}
                      onClick={() => selectPrimaryService(service)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-2xl flex-shrink-0">
                            {getServiceIcon(service.care_types.category)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <h4 className="font-semibold text-base">{service.care_types.name}</h4>
                              <Badge variant="secondary" className="shrink-0">${service.care_types.price}/hr</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {service.care_types.description || service.care_types.keywords}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {bookingData.primaryService && (
                  <div className="border-t pt-6">
                    <h4 className="text-lg font-semibold mb-3">Add Another Service? (Optional)</h4>
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Current Selection</span>
                        <Badge>{bookingData.duration} Hours</Badge>
                      </div>
                      <p className="text-lg font-semibold">${(bookingData.duration * bookingData.rate).toFixed(2)}</p>
                    </div>

                    <div className="grid gap-3 mb-4">
                      <Card
                        className={`cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] ${
                          !bookingData.additionalService
                            ? 'border-primary bg-primary/5 ring-2 ring-primary'
                            : 'hover:border-primary/50'
                        }`}
                        onClick={() => selectAdditionalService(null)}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-center gap-3">
                            <div className="text-2xl">➡️</div>
                            <div>
                              <p className="font-medium">Skip - No Additional Service</p>
                              <p className="text-xs text-muted-foreground">Continue with 4-hour service only</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {additionalServices.map((service) => (
                        <Card
                          key={service.id}
                          className={`cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] ${
                            bookingData.additionalService?.id === service.id
                              ? 'border-primary bg-primary/5 ring-2 ring-primary'
                              : 'hover:border-primary/50'
                          }`}
                          onClick={() => selectAdditionalService(service)}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent to-success flex items-center justify-center text-xl flex-shrink-0">
                                {getServiceIcon(service.care_types.category)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <h4 className="font-medium text-sm">{service.care_types.name}</h4>
                                  <Badge variant="secondary" className="shrink-0">${service.care_types.price}/hr</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground line-clamp-1">
                                  {service.care_types.description}
                                </p>
                                <Badge variant="secondary" className="mt-1">+4 hours</Badge>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" onClick={resetForm} className="flex-1">
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => setStep(2)} 
                    className="flex-1"
                    disabled={!bookingData.primaryService}
                  >
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Choose Day & Time + Caregiver */}
            {step === 2 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <h3 className="text-2xl font-bold mb-2">Choose Day & Time</h3>
                  <p className="text-sm text-muted-foreground">Select when you need care</p>
                </div>

                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Service Duration</span>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">{bookingData.duration} Hours</p>
                      <p className="text-sm">${(bookingData.duration * bookingData.rate).toFixed(2)}</p>
                    </div>
                  </div>
                </div>

                {/* Day Selection */}
                <div className="space-y-3">
                  <Label className="text-base font-semibold">Select Day of Week</Label>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                    {dayNames.map((day, idx) => (
                      <Card
                        key={idx}
                        className={`cursor-pointer text-center transition-all hover:scale-105 ${
                          bookingData.day === idx
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'hover:border-primary/50'
                        }`}
                        onClick={() => selectDay(idx)}
                      >
                        <CardContent className="p-3">
                          <p className="text-sm font-semibold">{day}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Start Date Selection */}
                {bookingData.day !== null && (
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">Start Date</Label>
                    <Input
                      type="date"
                      value={bookingData.startDate}
                      onChange={(e) => setBookingData(prev => ({ ...prev, startDate: e.target.value }))}
                      min={new Date().toISOString().split('T')[0]}
                      className="text-base"
                    />
                    {bookingData.startDate && (
                      <p className="text-sm text-muted-foreground">
                        Starts on {new Date(bookingData.startDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                )}

                {/* Repeat Options */}
                <div className="space-y-3">
                  <Label className="text-base font-semibold">Repeat Schedule</Label>
                  <RadioGroup value={bookingData.repeat} onValueChange={(value) => 
                    setBookingData(prev => ({ ...prev, repeat: value as any }))
                  }>
                    <div className="grid grid-cols-2 gap-3">
                      <Label className="cursor-pointer">
                        <Card className={`transition-all ${bookingData.repeat === 'once' ? 'border-primary bg-primary/5' : ''}`}>
                          <CardContent className="p-3 flex items-center gap-2">
                            <RadioGroupItem value="once" id="once" />
                            <div>
                              <p className="font-medium text-sm">One time only</p>
                            </div>
                          </CardContent>
                        </Card>
                      </Label>
                      <Label className="cursor-pointer">
                        <Card className={`transition-all ${bookingData.repeat === 'weekly' ? 'border-primary bg-primary/5' : ''}`}>
                          <CardContent className="p-3 flex items-center gap-2">
                            <RadioGroupItem value="weekly" id="weekly" />
                            <div>
                              <p className="font-medium text-sm">Weekly</p>
                              <p className="text-xs text-muted-foreground">Same day each week</p>
                            </div>
                          </CardContent>
                        </Card>
                      </Label>
                      <Label className="cursor-pointer">
                        <Card className={`transition-all ${bookingData.repeat === 'biweekly' ? 'border-primary bg-primary/5' : ''}`}>
                          <CardContent className="p-3 flex items-center gap-2">
                            <RadioGroupItem value="biweekly" id="biweekly" />
                            <div>
                              <p className="font-medium text-sm">Every 2 weeks</p>
                              <p className="text-xs text-muted-foreground">Same day, bi-weekly</p>
                            </div>
                          </CardContent>
                        </Card>
                      </Label>
                      <Label className="cursor-pointer">
                        <Card className={`transition-all ${bookingData.repeat === 'monthly' ? 'border-primary bg-primary/5' : ''}`}>
                          <CardContent className="p-3 flex items-center gap-2">
                            <RadioGroupItem value="monthly" id="monthly" />
                            <div>
                              <p className="font-medium text-sm">Monthly</p>
                              <p className="text-xs text-muted-foreground">Once per month</p>
                            </div>
                          </CardContent>
                        </Card>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* Available Caregivers */}
                {bookingData.day !== null && (
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">Available Caregivers & Times</Label>
                    
                    {loadingCaregivers ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                        <p className="text-sm text-muted-foreground">Finding available caregivers...</p>
                      </div>
                    ) : availableCaregivers.length === 0 ? (
                      <Card className="bg-muted/50">
                        <CardContent className="p-8 text-center">
                          <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">
                            No caregivers available for {dayNames[bookingData.day]}. Please select another day.
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-3 max-h-[400px] overflow-y-auto">
                        {availableCaregivers.map((caregiver) => {
                          const daySlot = caregiver.caregiver_availability?.find(
                            slot => slot.day_of_week === bookingData.day
                          );
                          
                          return (
                            <Card
                              key={caregiver.id}
                              className={`transition-all ${
                                bookingData.caregiver?.id === caregiver.id
                                  ? 'border-primary bg-primary/5'
                                  : ''
                              }`}
                            >
                              <CardContent className="p-4">
                                <div className="flex items-center gap-3 mb-3">
                                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-bold">
                                    {caregiver.first_name[0]}{caregiver.last_name[0]}
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-semibold">{caregiver.first_name} {caregiver.last_name}</h4>
                                    <div className="flex items-center gap-2 text-sm">
                                      {caregiver.avg_rating != null ? (
                                        <>
                                          <Star className="h-4 w-4 fill-warning text-warning" />
                                          <span>
                                            {caregiver.avg_rating.toFixed(1)} rating (
                                            {caregiver.rating_count})
                                          </span>
                                        </>
                                      ) : (
                                        <span className="text-muted-foreground">No ratings yet</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {daySlot && (() => {
                                  // Parse caregiver availability times
                                  const parseTime = (timeStr: string) => {
                                    const [hours, minutes] = timeStr.split(':').map(Number);
                                    return hours * 60 + minutes;
                                  };
                                  
                                  const availabilityStart = parseTime(daySlot.start_time);
                                  const availabilityEnd = parseTime(daySlot.end_time);
                                  const serviceDuration = bookingData.duration * 60; // Convert hours to minutes
                                  
                                  // Filter time slots based on availability
                                  const isTimeSlotAvailable = (time: string, period: string) => {
                                    let hours = parseInt(time.split(':')[0]);
                                    if (period === 'PM' && hours !== 12) hours += 12;
                                    if (period === 'AM' && hours === 12) hours = 0;
                                    
                                    const slotStart = hours * 60;
                                    const slotEnd = slotStart + serviceDuration;
                                    
                                    return slotStart >= availabilityStart && slotEnd <= availabilityEnd;
                                  };
                                  
                                  const availableMorning = timeSlots.morning.filter(time => isTimeSlotAvailable(time, 'AM'));
                                  const availableAfternoon = timeSlots.afternoon.filter(time => isTimeSlotAvailable(time, 'PM'));
                                  const availableEvening = timeSlots.evening.filter(time => isTimeSlotAvailable(time, 'PM'));
                                  
                                  return (
                                    <div className="space-y-2">
                                      {availableMorning.length > 0 && (
                                        <>
                                          <p className="text-xs font-medium text-muted-foreground uppercase">Morning</p>
                                          <div className="grid grid-cols-3 gap-2">
                                            {availableMorning.map(time => (
                                              <Button
                                                key={time}
                                                variant={bookingData.time === `${time} AM` && bookingData.caregiver?.id === caregiver.id ? 'default' : 'outline'}
                                                size="sm"
                                                className="text-xs"
                                                onClick={() => selectTimeSlot(caregiver, time, 'AM')}
                                              >
                                                {time} AM
                                              </Button>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                      
                                      {availableAfternoon.length > 0 && (
                                        <>
                                          <p className="text-xs font-medium text-muted-foreground uppercase mt-3">Afternoon</p>
                                          <div className="grid grid-cols-3 gap-2">
                                            {availableAfternoon.map(time => (
                                              <Button
                                                key={time}
                                                variant={bookingData.time === `${time} PM` && bookingData.caregiver?.id === caregiver.id ? 'default' : 'outline'}
                                                size="sm"
                                                className="text-xs"
                                                onClick={() => selectTimeSlot(caregiver, time, 'PM')}
                                              >
                                                {time} PM
                                              </Button>
                                            ))}
                                          </div>
                                        </>
                                      )}

                                      {availableEvening.length > 0 && (
                                        <>
                                          <p className="text-xs font-medium text-muted-foreground uppercase mt-3">Evening</p>
                                          <div className="grid grid-cols-3 gap-2">
                                            {availableEvening.map(time => (
                                              <Button
                                                key={time}
                                                variant={bookingData.time === `${time} PM` && bookingData.caregiver?.id === caregiver.id ? 'default' : 'outline'}
                                                size="sm"
                                                className="text-xs"
                                                onClick={() => selectTimeSlot(caregiver, time, 'PM')}
                                              >
                                                {time} PM
                                              </Button>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                      
                                      {availableMorning.length === 0 && availableAfternoon.length === 0 && availableEvening.length === 0 && (
                                        <p className="text-sm text-muted-foreground text-center py-4">
                                          No available time slots for {bookingData.duration}hr service
                                        </p>
                                      )}
                                    </div>
                                  );
                                })()}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                    Back
                  </Button>
                  <Button 
                    onClick={() => setStep(3)} 
                    className="flex-1"
                    disabled={!bookingData.caregiver || !bookingData.time}
                  >
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Confirm Booking */}
            {step === 3 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <h3 className="text-2xl font-bold mb-2">Confirm Booking</h3>
                  <p className="text-sm text-muted-foreground">Review your care request</p>
                </div>

                <Card className="bg-muted/50">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Services:</span>
                      <span className="font-semibold text-right">
                        {bookingData.primaryService?.care_types.name}
                        {bookingData.additionalService && `, ${bookingData.additionalService.care_types.name}`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Caregiver:</span>
                      <span className="font-semibold">
                        {bookingData.caregiver?.first_name} {bookingData.caregiver?.last_name}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Schedule:</span>
                      <span className="font-semibold">
                        {bookingData.day !== null && dayNames[bookingData.day]} ({bookingData.repeat})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Time:</span>
                      <span className="font-semibold">{bookingData.time}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Duration:</span>
                      <span className="font-semibold">{bookingData.duration} hours</span>
                    </div>
                    <div className="border-t pt-4 flex justify-between">
                      <span className="text-lg font-bold">Total:</span>
                      <span className="text-lg font-bold text-primary">
                        ${bookingData.duration * bookingData.rate}
                        {bookingData.repeat !== 'once' && `/${bookingData.repeat}`}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                    Back
                  </Button>
                  <Button 
                    onClick={handleSubmitBooking} 
                    className="flex-1"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      'Confirm Booking'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* All Orders Display */}
      {!showOrderForm && (
        <Card>
          <CardHeader>
            <CardTitle>Your Care Plans</CardTitle>
            <CardDescription>{allOrders.length} active care plan{allOrders.length !== 1 ? 's' : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            {allOrders.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">No active orders</p>
                <p className="text-sm text-muted-foreground">Create your first order to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {allOrders.map((order) => (
                  <Card key={order.id} className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4" />
                            <p className="font-semibold">{order.order_number}</p>
                            {getStatusBadge(order.status)}
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            <span>{new Date(order.start_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })} - {new Date(order.end_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</span>
                          </div>
                          <div className="text-sm text-muted-foreground capitalize">
                            <Clock className="h-4 w-4 inline mr-1" />
                            {order.frequency}
                          </div>
                        </div>
                        <Button variant="outline" size="sm">View Details</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};